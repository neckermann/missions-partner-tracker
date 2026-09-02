const express = require("express");
const jwt = require("jsonwebtoken");
const {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  randomNonce,
} = require("openid-client");
const prisma = require("../prismaClient");
const { setSessionCookie } = require("../utils/jwt");
const { decryptField } = require("../utils/crypto");
const { appBaseUrl } = require("../utils/urls");

const router = express.Router();

// One generic OIDC login flow serves every provider (Entra ID, Google,
// Okta, or any other standards-compliant IdP) — `type` on the SsoProvider
// row is only a cosmetic hint for the admin/login UI. Discovery
// (`${issuerUrl}/.well-known/openid-configuration`) is what actually
// varies between them.
const STATE_TTL = "10m";
const CALLBACK_PATH = "/api/auth/sso/callback";

// This must be absolute (registered with the IdP as the Reply URL /
// Authorized redirect URI) — everything else in this file redirects the
// browser with a plain relative path, since frontend and backend are the
// same origin.
function redirectUri() {
  return `${appBaseUrl()}${CALLBACK_PATH}`;
}

// GET /api/auth/sso/providers — public list of enabled providers, for the
// login page to render one button per provider. No secrets included.
router.get("/providers", async (req, res, next) => {
  try {
    const providers = await prisma.ssoProvider.findMany({
      where: { enabled: true },
      select: { id: true, type: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    res.json(providers);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/sso/:providerId/login — redirects the browser to the
// provider's authorization endpoint. State/nonce/PKCE verifier are packed
// into a short-lived signed JWT used as the `state` parameter itself,
// rather than kept server-side — there's no server-side session store for
// this exchange, so self-describing state means the callback needs
// nothing but what the IdP hands back in the query string.
router.get("/:providerId/login", async (req, res) => {
  try {
    const provider = await prisma.ssoProvider.findUnique({ where: { id: req.params.providerId } });
    if (!provider || !provider.enabled) {
      return res.redirect("/login?error=sso");
    }

    const config = await discovery(
      new URL(provider.issuerUrl),
      provider.clientId,
      decryptField(provider.clientSecret)
    );

    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const nonce = randomNonce();
    const state = jwt.sign(
      { providerId: provider.id, nonce, codeVerifier },
      process.env.SESSION_SECRET,
      { expiresIn: STATE_TTL }
    );

    const authUrl = buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(),
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    res.redirect(authUrl.toString());
  } catch (err) {
    console.error("[sso] failed to start login:", err);
    res.redirect("/login?error=sso");
  }
});

// GET /api/auth/sso/callback — shared redirect URI for every provider (the
// `state` param, decoded below, says which one this response belongs to).
// Register this exact URL as the Reply URL / Authorized redirect URI in
// each IdP's app registration.
router.get("/callback", async (req, res) => {
  try {
    const { state } = req.query;
    if (!state) throw new Error("Missing state parameter");

    let decoded;
    try {
      decoded = jwt.verify(String(state), process.env.SESSION_SECRET);
    } catch {
      throw new Error("Invalid or expired SSO state");
    }
    const { providerId, nonce, codeVerifier } = decoded;

    const provider = await prisma.ssoProvider.findUnique({ where: { id: providerId } });
    if (!provider || !provider.enabled) throw new Error("SSO provider is no longer available");

    const config = await discovery(
      new URL(provider.issuerUrl),
      provider.clientId,
      decryptField(provider.clientSecret)
    );

    const currentUrl = new URL(req.originalUrl, appBaseUrl());
    const tokens = await authorizationCodeGrant(config, currentUrl, {
      expectedState: String(state),
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    const claims = tokens.claims();
    const email = String(claims?.email || "").toLowerCase().trim();
    if (!email) throw new Error("No email claim in ID token");

    if (provider.allowedDomain && !email.endsWith(`@${provider.allowedDomain}`)) {
      throw new Error("Email domain not allowed");
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Auto-provision on first SSO login, same as the app has always
      // done — default to "editor", promote to "admin" manually once
      // trusted.
      user = await prisma.user.create({
        data: {
          email,
          name: claims.name || email,
          authProvider: provider.type,
          ssoProviderId: provider.id,
          role: "editor",
        },
      });
    } else {
      if (!user.active) throw new Error("Account disabled");
      user = await prisma.user.update({
        where: { id: user.id },
        data: { authProvider: provider.type, ssoProviderId: provider.id, lastLoginAt: new Date() },
      });
    }

    setSessionCookie(res, user);
    res.redirect("/admin");
  } catch (err) {
    console.error("[sso] callback failed:", err);
    res.redirect("/login?error=sso");
  }
});

module.exports = router;

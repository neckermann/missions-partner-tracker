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
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/api/auth/sso/callback";
// Holds the PKCE code_verifier between /login and /callback. Kept out of
// the `state` JWT deliberately — state round-trips through the browser to
// the external IdP and back (it's a URL query param on the authorization
// request), so anything in it is visible in the IdP's own logs, browser
// history, and any Referer header the IdP's login page happens to send.
// The verifier is supposed to prove "the same client that started the
// flow" — putting it somewhere that leaves this server's own
// browser-to-server channel undercuts that. A cookie, scoped to only this
// callback path, never leaves that channel.
const PKCE_COOKIE_NAME = "sso_pkce_verifier";

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
// provider's authorization endpoint. State/nonce are packed into a
// short-lived signed JWT used as the `state` parameter itself, rather than
// kept server-side — there's no server-side session store for this
// exchange, so self-describing state means the callback needs nothing but
// what the IdP hands back in the query string. The PKCE verifier is the
// one exception — see PKCE_COOKIE_NAME above for why it's a cookie instead.
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
    const state = jwt.sign({ providerId: provider.id, nonce }, process.env.SESSION_SECRET, {
      expiresIn: STATE_TTL,
    });

    res.cookie(PKCE_COOKIE_NAME, codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
      path: CALLBACK_PATH, // only ever sent back on the callback request
    });

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
    const { providerId, nonce } = decoded;

    // Read once, clear immediately — a codeVerifier is single-use, and
    // clearing it now (rather than only on success) means a retried or
    // duplicated callback request can't reuse it either.
    const codeVerifier = req.cookies?.[PKCE_COOKIE_NAME];
    res.clearCookie(PKCE_COOKIE_NAME, { path: CALLBACK_PATH });
    if (!codeVerifier) throw new Error("Missing PKCE verifier — cookie expired or was blocked");

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
      // Auto-provision on first SSO login. Defaults to "viewer" (read-only,
      // no write access) rather than "editor" — this app has no way to
      // gate SSO sign-in to a pre-approved list of people beyond the
      // optional allowedDomain check above, so the safe default assumes an
      // unknown first-time SSO user hasn't been vetted yet. Promote to
      // "editor"/"admin" manually once trusted — see ADMIN_GUIDE.md §
      // Single sign-on (SSO) for why this matters and how to restrict who
      // can reach this flow at all (gate access on the identity provider's
      // side, not just here).
      user = await prisma.user.create({
        data: {
          email,
          name: claims.name || email,
          authProvider: provider.type,
          ssoProviderId: provider.id,
          role: "viewer",
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

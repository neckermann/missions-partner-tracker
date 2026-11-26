const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const prisma = require("../prismaClient");
const { requireAuth, requireAuthOrMfaSetup } = require("../middleware/requireAuth");
const { setSessionCookie } = require("../utils/jwt");
const { recordAuditSafe } = require("../utils/auditLog");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const { isDemoDeployment, endOtherSessions } = require("../utils/demoMode");
const { isPasskeySignInOn } = require("../utils/passwordless");
const {
  MAX_PASSKEYS,
  relyingParty,
  signChallenge,
  consumeChallenge,
  toB64u,
  fromB64u,
} = require("../utils/passkeys");

// Passkeys as a second sign-in factor (#386). Mounted at /api/auth/passkeys by routes/auth.js,
// which hands over its `completeLogin` so a passkey sign-in ends exactly as a code sign-in does.
module.exports = function passkeyRoutes({ completeLogin }) {
  const router = express.Router();

  const publicPasskey = (p) => ({
    id: p.id,
    label: p.label,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  });

  // GET /api/auth/passkeys -- the signed-in person's own passkeys.
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const rows = await prisma.userPasskey.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: "asc" },
      });
      res.json({ passkeys: rows.map(publicPasskey), max: MAX_PASSKEYS, demo: isDemoDeployment() });
    } catch (err) {
      next(err);
    }
  });

  // A session, or the forced-enrolment setup token (a person the church requires two-factor of
  // who has none yet): in that case finishing also signs them in, like a verified code does.

  router.post("/register/options", requireAuthOrMfaSetup, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { passkeys: { select: { credentialId: true, transports: true } } },
      });
      if (!user) return res.status(401).json({ error: "Invalid or expired session" });
      // A forced-enrolment setup token is only good while the account has nothing enrolled, like
      // /mfa/setup: once it has (or an admin has reset it) the token must not become a session (#408).
      if (req.user.mfaSetup && user.mfaEnabled) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      if (user.passkeys.length >= MAX_PASSKEYS) {
        return res.status(409).json({ error: `You can have up to ${MAX_PASSKEYS} passkeys` });
      }
      const rp = relyingParty(req);
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        userDisplayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
        attestationType: "none",
        excludeCredentials: user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: p.transports,
        })),
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      });
      res.json({
        options,
        challengeToken: signChallenge({
          challenge: options.challenge,
          purpose: "register",
          userId: user.id,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  const registerSchema = z.object({
    challengeToken: z.string().min(1),
    response: z.object({ id: z.string().min(1) }).passthrough(),
    label: z.string().trim().max(60).optional(),
  });

  router.post("/register/verify", requireAuthOrMfaSetup, async (req, res, next) => {
    try {
      const body = registerSchema.parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { _count: { select: { passkeys: true } } },
      });
      if (!user) return res.status(401).json({ error: "Invalid or expired session" });
      if (req.user.mfaSetup && user.mfaEnabled) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      if (user._count.passkeys >= MAX_PASSKEYS) {
        return res.status(409).json({ error: `You can have up to ${MAX_PASSKEYS} passkeys` });
      }
      const challenge = await consumeChallenge(body.challengeToken, { purpose: "register", userId: user.id });
      if (!challenge) return res.status(400).json({ error: "That took too long. Please try again." });

      const rp = relyingParty(req);
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: rp.origins,
          expectedRPID: rp.rpID,
        });
      } catch {
        return res.status(400).json({ error: "That passkey couldn't be verified" });
      }
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: "That passkey couldn't be verified" });
      }
      const { credential } = verification.registrationInfo;
      const label = body.label || `Passkey ${user._count.passkeys + 1}`;
      try {
        await prisma.userPasskey.create({
          data: {
            userId: user.id,
            credentialId: credential.id,
            publicKey: toB64u(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports || [],
            label,
          },
        });
      } catch (err) {
        if (err.code === "P2002")
          return res.status(409).json({ error: "That passkey is already registered" });
        throw err;
      }
      // An abandoned authenticator-app enrolment (secret saved, never confirmed) is cleared so a
      // person is never half in each.
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: user.mfaEnabled
          ? {}
          : {
              mfaEnabled: true,
              mfaSecret: null,
              mfaSetupRequired: false,
              mfaLastTimeStep: null,
              // The first factor ends sessions opened without one, as enrolling an app does (#408).
              ...endOtherSessions(),
            },
      });
      await recordAuditSafe(null, {
        action: "auth.passkey_added",
        actor: updated,
        req,
        details: { label },
      });
      if (req.user.mfaSetup) {
        return res.json(await completeLogin(res, updated, req));
      }
      // This tab keeps its session: its cookie is re-issued from the updated row.
      if (!user.mfaEnabled) setSessionCookie(res, updated);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: "Current password is required" });
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      const passkey = await prisma.userPasskey.findFirst({
        where: { id: req.params.id, userId: user.id },
      });
      if (!passkey) return res.status(404).json({ error: "Not found" });

      const remaining = await prisma.userPasskey.count({
        where: { userId: user.id, id: { not: passkey.id } },
      });
      const hasApp = Boolean(user.mfaSecret);
      const lastFactor = remaining === 0 && !hasApp;
      if (lastFactor && (await isTwoFactorRequired())) {
        return res.status(403).json({
          error:
            "Your church requires two-factor authentication. Add another passkey or an authenticator app first.",
        });
      }
      await prisma.userPasskey.delete({ where: { id: passkey.id } });
      let updated = user;
      if (lastFactor) {
        // Nothing left to ask for, and sessions opened with it end, as when two-factor is switched off.
        updated = await prisma.user.update({
          where: { id: user.id },
          data: { mfaEnabled: false, ...endOtherSessions() },
        });
        setSessionCookie(res, updated);
      }
      await recordAuditSafe(null, {
        action: "auth.passkey_removed",
        actor: updated,
        req,
        details: { label: passkey.label },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Second step after a correct password, exactly where the authenticator-app code goes.

  function pendingUser(pendingToken) {
    let decoded;
    try {
      decoded = jwt.verify(String(pendingToken || ""), process.env.SESSION_SECRET);
    } catch {
      return null;
    }
    return decoded.mfaPending ? decoded.id : null;
  }

  router.post("/login/options", async (req, res, next) => {
    try {
      const userId = pendingUser(req.body?.pendingToken);
      const user = userId
        ? await prisma.user.findUnique({ where: { id: userId }, include: { passkeys: true } })
        : null;
      if (!user || !user.active || !user.mfaEnabled || user.passkeys.length === 0) {
        return res.status(401).json({ error: "MFA session expired, please log in again" });
      }
      const rp = relyingParty(req);
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "preferred",
        allowCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
      });
      res.json({
        options,
        challengeToken: signChallenge({ challenge: options.challenge, purpose: "login", userId: user.id }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login/verify", async (req, res, next) => {
    try {
      const { pendingToken, challengeToken, response } = req.body || {};
      const userId = pendingUser(pendingToken);
      if (!userId || !response || typeof response.id !== "string") {
        return res.status(401).json({ error: "MFA session expired, please log in again" });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const passkey = await prisma.userPasskey.findFirst({
        where: { userId, credentialId: response.id },
      });
      const fail = async (reason) => {
        if (user) {
          await recordAuditSafe(null, {
            action: "auth.login_failed",
            target: user,
            req,
            details: { reason },
          });
        }
        return res.status(401).json({ error: "That passkey didn't work" });
      };
      if (!user || !user.active || !user.mfaEnabled || !passkey) return fail("passkey_unknown");
      const challenge = await consumeChallenge(challengeToken, { purpose: "login", userId });
      if (!challenge) return fail("passkey_challenge");

      const rp = relyingParty(req);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.origins,
          expectedRPID: rp.rpID,
          credential: {
            id: passkey.credentialId,
            publicKey: fromB64u(passkey.publicKey),
            counter: passkey.counter,
            transports: passkey.transports,
          },
        });
      } catch {
        return fail("passkey_invalid");
      }
      if (!verification.verified) return fail("passkey_invalid");
      await prisma.userPasskey.update({
        where: { id: passkey.id },
        data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
      });
      res.json(await completeLogin(res, user, req));
    } catch (err) {
      next(err);
    }
  });

  // The passkey is the whole sign-in: no password, no pending token. Available when the church allows it
  // (allowPasskeySignIn, offered beside the password form) or passwordless mode is on (which removes
  // the password form). User verification is required, so it is as strong as password plus a second step. No email is asked for, so
  // nothing here reveals which addresses have accounts: the browser offers the passkeys it holds
  // for this site and the answer names the credential.

  router.post("/passwordless/options", async (req, res, next) => {
    try {
      if (!(await isPasskeySignInOn())) return res.status(404).json({ error: "Not found" });
      const rp = relyingParty(req);
      const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
      res.json({
        options,
        challengeToken: signChallenge({ challenge: options.challenge, purpose: "passwordless", userId: "" }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/passwordless/verify", async (req, res, next) => {
    try {
      if (!(await isPasskeySignInOn())) return res.status(404).json({ error: "Not found" });
      const { challengeToken, response } = req.body || {};
      const passkey =
        response && typeof response.id === "string"
          ? await prisma.userPasskey.findUnique({
              where: { credentialId: response.id },
              include: { user: true },
            })
          : null;
      const challenge = await consumeChallenge(challengeToken, { purpose: "passwordless", userId: "" });
      const user = passkey?.user;
      const fail = async (reason) => {
        if (user) {
          await recordAuditSafe(null, {
            action: "auth.login_failed",
            target: user,
            req,
            details: { reason },
          });
        }
        return res.status(401).json({ error: "That passkey didn't work" });
      };
      if (!challenge || !passkey || !user.active || user.authProvider !== "local") {
        return fail("passkey_unknown");
      }
      const rp = relyingParty(req);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.origins,
          expectedRPID: rp.rpID,
          requireUserVerification: true,
          credential: {
            id: passkey.credentialId,
            publicKey: fromB64u(passkey.publicKey),
            counter: passkey.counter,
            transports: passkey.transports,
          },
        });
      } catch {
        return fail("passkey_invalid");
      }
      if (!verification.verified) return fail("passkey_invalid");
      await prisma.userPasskey.update({
        where: { id: passkey.id },
        data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
      });
      res.json(await completeLogin(res, user, req));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

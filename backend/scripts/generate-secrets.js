#!/usr/bin/env node
// Prints ready-to-paste values for the two secrets this app requires.
//
// Deliberately prints rather than writing .env: a script that edits .env will
// eventually clobber someone's real configuration, and the whole point of
// these values is that losing them is unrecoverable (FIELD_ENCRYPTION_KEY
// especially -- every already-encrypted MFA secret becomes unreadable).
//
// Usage: npm run generate-secrets

const crypto = require("crypto");

// 48 bytes for the JWT signing key -- comfortably past the 32-character
// minimum the config validator enforces. Exactly 32 bytes for the field
// encryption key, because AES-256-GCM requires a 256-bit key and
// utils/crypto.js rejects anything else.
const sessionSecret = crypto.randomBytes(48).toString("base64");
const fieldEncryptionKey = crypto.randomBytes(32).toString("base64");

console.log(`
Copy these into backend/.env — and store them somewhere durable.

SESSION_SECRET="${sessionSecret}"
FIELD_ENCRYPTION_KEY="${fieldEncryptionKey}"

Notes:
  • Never reuse either value across environments.
  • Changing SESSION_SECRET signs everyone out; that's all.
  • Changing FIELD_ENCRYPTION_KEY permanently destroys every secret already
    encrypted with the old one — currently everyone's two-factor enrollment.
`);

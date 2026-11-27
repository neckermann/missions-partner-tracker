// Gets someone back in when they have lost their authenticator app, their passkeys AND their recovery codes,
// and no other admin can reset them (a church with one admin). Run by whoever runs the server:
//
//   npm run clear-two-factor -- you@yourchurch.org
//
// It removes the account's authenticator secret, passkeys and recovery codes and signs the account out
// everywhere. The next password sign-in goes straight to setting two-factor up again, and shows a new set of
// recovery codes. Nothing else about the account changes. It needs the same DATABASE_URL as the server.
require("dotenv").config({ quiet: true });
const prisma = require("../src/prismaClient");
const { recordAuditSafe } = require("../src/utils/auditLog");

async function main() {
  const email = (process.argv[2] || "").toLowerCase().trim();
  if (!email) {
    console.error("Usage: npm run clear-two-factor -- <email>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.userPasskey.deleteMany({ where: { userId: user.id } }),
    prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaLastTimeStep: null,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
  await recordAuditSafe(null, { action: "auth.mfa_cleared_by_server", target: user });
  console.log(
    `Two-factor cleared for ${user.email}. Sign in with the password; you will be asked to set two-factor up again.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

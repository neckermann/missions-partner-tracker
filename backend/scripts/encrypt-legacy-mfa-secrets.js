// One-time data migration: encrypts any User.mfaSecret values that predate
// field-level encryption (see backend/src/utils/crypto.js and
// UPGRADING.md). Safe to run more than once — already-encrypted values are
// left untouched.
require("dotenv").config();
const prisma = require("../src/prismaClient");
const { encryptField, isEncrypted } = require("../src/utils/crypto");

async function main() {
  const users = await prisma.user.findMany({ where: { mfaSecret: { not: null } } });

  let migrated = 0;
  for (const user of users) {
    if (isEncrypted(user.mfaSecret)) continue;
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptField(user.mfaSecret) },
    });
    migrated++;
  }

  console.log(
    `Encrypted ${migrated} of ${users.length} mfaSecret value(s) (${users.length - migrated} already encrypted).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

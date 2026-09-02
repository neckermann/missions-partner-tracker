// Creates (or updates) a local admin user so you can log in before SSO
// is configured. Run with:
//   node prisma/createAdmin.js you@yourchurch.org "YourStrongPassword!"

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node prisma/createAdmin.js <email> "<password>"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase().trim() },
    update: { passwordHash, role: "admin", authProvider: "local", active: true },
    create: {
      email: email.toLowerCase().trim(),
      passwordHash,
      role: "admin",
      authProvider: "local",
    },
  });

  console.log(`Admin user ready: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

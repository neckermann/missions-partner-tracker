// Creates (or updates) an admin user so you can log in. Run with:
//   node prisma/createAdmin.js you@yourchurch.org "YourStrongPassword!"

// Prisma 7 doesn't auto-load .env, and this script runs standalone (not through server.js),
// so it loads it explicitly.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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

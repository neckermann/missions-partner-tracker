// Opt-in script: runs a real Claude extraction scan against each fixture
// letter in test/fixtures/extraction/ and prints the results next to its
// answer key, for a human to compare. Not part of `npm test` or
// `npm run test:routes` -- every run spends real money on whichever
// Anthropic account ANTHROPIC_API_KEY belongs to, and comparing extracted
// background/requestText against an answer key's expected phrasing is a
// judgment call, not something worth a brittle string-match assertion.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npm run check:extraction
//   ANTHROPIC_API_KEY=sk-ant-... npm run check:extraction -- hartwell
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const prisma = require("../src/prismaClient");
const { encryptField } = require("../src/utils/crypto");
const { extractRequestsFromFile } = require("../src/utils/extraction");

const FIXTURES_DIR = path.join(__dirname, "../test/fixtures/extraction");

// extractRequestsFromFile only reads PDF/JPEG/PNG natively, or .eml via
// mailparser (see isEml/buildFileBlock) -- wrapping each plain-text
// fixture as a minimal .eml runs it through the exact same code path a
// real forwarded letter would take, rather than adding a third, test-only
// input format to extraction.js itself.
function wrapAsEml(text) {
  return Buffer.from(
    `From: missionary@example.org\r\nTo: missions@example.org\r\nSubject: Update\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`
  );
}

// Temporarily points ChurchSettings.anthropicApiKey at the real key this
// script was given, restoring whatever was there before once done --
// extraction.js always reads the key from the DB (see its own comment on
// why), never from the environment directly.
async function withTemporaryApiKey(key, fn) {
  const existing = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { anthropicApiKey: true },
  });
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", anthropicApiKey: encryptField(key) },
    update: { anthropicApiKey: encryptField(key) },
  });
  try {
    return await fn();
  } finally {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { anthropicApiKey: existing?.anthropicApiKey ?? null },
    });
  }
}

function printResult(fileName, result) {
  console.log(`\n${"=".repeat(70)}\n${fileName}\n${"=".repeat(70)}`);
  console.log(`\nPrayer requests (${result.prayerRequests.length}):`);
  result.prayerRequests.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.category}]`);
    console.log(`     background: ${r.background}`);
    console.log(`     requestText: ${r.requestText}`);
  });
  console.log(`\nOne-time needs (${result.oneTimeNeeds.length}):`);
  result.oneTimeNeeds.forEach((n, i) => {
    const amount = n.requestedAmount != null ? `$${n.requestedAmount}` : "(no amount stated)";
    console.log(`  ${i + 1}. [${amount}]`);
    console.log(`     background: ${n.background}`);
    console.log(`     description: ${n.description}`);
  });
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("Set ANTHROPIC_API_KEY to run this script -- it makes real, billable API calls.");
    process.exit(1);
  }

  const filter = process.argv[2];
  const letters = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".txt"))
    .filter((f) => !filter || f.includes(filter));

  if (!letters.length) {
    console.error(filter ? `No fixture letter matches "${filter}"` : "No fixture letters found.");
    process.exit(1);
  }

  await withTemporaryApiKey(key, async () => {
    for (const fileName of letters) {
      const text = fs.readFileSync(path.join(FIXTURES_DIR, fileName), "utf8");
      const result = await extractRequestsFromFile({
        bytes: wrapAsEml(text),
        contentType: "message/rfc822",
        fileName: fileName.replace(/\.txt$/, ".eml"),
      });
      printResult(fileName, result);
      const answerKeyPath = path.join(FIXTURES_DIR, fileName.replace(/\.txt$/, "-answer-key.md"));
      if (fs.existsSync(answerKeyPath)) console.log(`\nAnswer key: ${answerKeyPath}`);
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

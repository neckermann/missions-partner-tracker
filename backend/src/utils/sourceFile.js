// A record created from an AI scan points at its file (`sourceFileId`), which must
// belong to the same partner: otherwise someone reaching one partner could set another's
// file id and read its title and name back.
const prisma = require("../prismaClient");

// Returns an error message, or null when there is no pointer or it is a file of `partnerId`.
async function sourceFileProblem(sourceFileId, partnerId, db = prisma) {
  if (!sourceFileId) return null;
  const file = await db.partnerFile.findFirst({
    where: { id: sourceFileId, partnerId },
    select: { id: true },
  });
  return file ? null : "That file isn't one of this partner's";
}

module.exports = { sourceFileProblem };

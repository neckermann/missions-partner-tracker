// A record created from an AI scan points at the file it came from (`sourceFileId`). The pointer
// must be a file of the same partner as the record: otherwise someone who reaches one partner could
// set another partner's file id and read its title and name back in the response (#412).
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

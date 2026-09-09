const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");

// Matches the fields PrayerRequest/SupportNeed actually need on create (see
// schema.prisma) -- dateReceived/requestDate aren't extracted, the caller
// defaults those to the source newsletter/document's own receivedDate.
const ExtractionSchema = z.object({
  prayerRequests: z.array(
    z.object({
      category: z.enum(["short_term", "long_term"]),
      requestText: z.string(),
    })
  ),
  oneTimeNeeds: z.array(
    z.object({
      description: z.string(),
      // null when a specific dollar figure isn't stated -- the review UI
      // leaves that field blank rather than guessing a number.
      requestedAmount: z.number().int().positive().nullable(),
    })
  ),
});

const SUPPORTED_CONTENT_TYPES = {
  "application/pdf": "document",
  "image/jpeg": "image",
  "image/png": "image",
};

const SYSTEM_PROMPT = `You read newsletters and letters from missionaries/organizations sent to their supporting church, looking for two specific things:

1. Prayer requests -- anything the writer is asking people to pray for. Mark "short_term" for something time-bound (an upcoming trip, a specific event, a near-term health concern) and "long_term" for an ongoing situation worth tracking over time (chronic illness, a long-running ministry challenge, a persistent family need).
2. One-time financial needs -- a specific, named ask for money (not their regular monthly support), e.g. "we need $1,000 to replace our vehicle" or "please help us cover $500 in medical bills." Only include ones with an actual ask, not general statements about being low on funds. If a dollar amount is stated, extract it as a plain integer number of dollars; if the need is described without a specific figure, leave requestedAmount null rather than guessing.

Prayer requests are often indirect ("please keep lifting up my mother's health," "pray for wisdom as we plan next steps") -- read for the actual meaning, not just explicit phrases like "prayer request." Return empty arrays for either category if nothing genuinely fits -- don't force a match.

requestText and description must be VERBATIM -- copy the exact sentence(s) stating the request/need character-for-character from the source, including the original person/pronouns ("I"/"we"/"our", never rewritten to "they"/"their"). Do not paraphrase, summarize, rephrase, or otherwise change the wording. The only edit you may make is trimming: cut down to just the sentence(s) that state the request/need itself rather than including the whole surrounding paragraph, and you may join two non-adjacent sentences with " ... " if both are needed for the request to make sense on its own -- but every word you do include must be copied exactly as written, not reworded.`;

function client() {
  return new Anthropic();
}

// contentType comes from the stored Newsletter/Document row -- both routes
// only ever accept PDF/JPEG/PNG uploads that pass a magic-byte check (see
// routes/newsletters.js, routes/documents.js), so this list matches what
// could ever actually reach here. Word/Excel/.eml aren't included: Claude's
// document input only natively reads PDF and image content, and this stays
// a single-call extraction rather than adding a separate text-extraction
// step for those formats.
function isExtractable(contentType) {
  return Boolean(SUPPORTED_CONTENT_TYPES[contentType]);
}

async function extractRequestsFromFile({ bytes, contentType }) {
  const blockType = SUPPORTED_CONTENT_TYPES[contentType];
  if (!blockType) {
    const err = new Error(`Can't scan a ${contentType} file -- only PDF, JPEG, or PNG are supported`);
    err.status = 400;
    throw err;
  }

  // Prisma's driver adapter (@prisma/adapter-pg) returns Bytes columns as a
  // plain Uint8Array, not a Node Buffer -- Uint8Array has no overridden
  // toString(encoding), so bytes.toString("base64") silently produces
  // "37,80,68,70,..." (Array.prototype.toString's comma-joined decimals)
  // instead of base64. Buffer.from() wraps the same underlying data without
  // copying it, and does have the real base64 encoder.
  const base64 = Buffer.from(bytes).toString("base64");
  const fileBlock =
    blockType === "document"
      ? { type: "document", source: { type: "base64", media_type: contentType, data: base64 } }
      : { type: "image", source: { type: "base64", media_type: contentType, data: base64 } };

  const response = await client().messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: "Extract any prayer requests and one-time financial needs from this document." }],
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    const err = new Error("The AI declined to process this file");
    err.status = 422;
    throw err;
  }

  // parsed_output is null if parsing failed (shouldn't happen with a
  // schema this simple, but structured output isn't a hard guarantee).
  return response.parsed_output || { prayerRequests: [], oneTimeNeeds: [] };
}

module.exports = { extractRequestsFromFile, isExtractable, ExtractionSchema };

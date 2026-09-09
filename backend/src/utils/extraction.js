const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { simpleParser } = require("mailparser");

// Matches the fields PrayerRequest/SupportNeed actually need on create (see
// schema.prisma) -- dateReceived/requestDate aren't extracted, the caller
// defaults those to the source newsletter/document's own receivedDate.
const ExtractionSchema = z.object({
  prayerRequests: z.array(
    z.object({
      category: z.enum(["strategic", "situational"]),
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

1. Prayer requests -- anything the writer is asking people to pray for. Mark "strategic" when it ties to the ministry's long-term vision or calling -- church planting progress, discipleship/training programs, language learning tied to ministry effectiveness, funding or partnership development, outreach campaigns, relational bridge-building with a people group. Mark "situational" for whatever came up that isn't necessarily tied to ministry vision -- illness or injury, travel safety, family needs back home, visa/paperwork issues, housing or logistics problems, a sudden personal hardship.
2. One-time financial needs -- a specific, named ask for money (not their regular monthly support), e.g. "we need $1,000 to replace our vehicle" or "please help us cover $500 in medical bills." Only include ones with an actual ask, not general statements about being low on funds. If a dollar amount is stated, extract it as a plain integer number of dollars; if the need is described without a specific figure, leave requestedAmount null rather than guessing.

Prayer requests are often indirect ("please keep lifting up my mother's health," "pray for wisdom as we plan next steps") -- read for the actual meaning, not just explicit phrases like "prayer request." Return empty arrays for either category if nothing genuinely fits -- don't force a match.

requestText and description must be VERBATIM -- copy the exact sentence(s) stating the request/need character-for-character from the source, including the original person/pronouns ("I"/"we"/"our", never rewritten to "they"/"their"). Do not paraphrase, summarize, rephrase, or otherwise change the wording. The only edit you may make is trimming: cut down to just the sentence(s) that state the request/need itself rather than including the whole surrounding paragraph, and you may join two non-adjacent sentences with " ... " if both are needed for the request to make sense on its own -- but every word you do include must be copied exactly as written, not reworded.`;

function client() {
  return new Anthropic();
}

// .eml's browser-reported contentType is unreliable (often
// application/octet-stream or blank -- see the same comment in
// routes/newsletters.js/documents.js), so it's recognized by filename
// extension instead, same as upload-time validation does.
function isEml(fileName) {
  return /\.eml$/i.test(fileName || "");
}

// Builds the one Claude content block this file becomes: PDF/JPEG/PNG go in
// as-is (native document/vision input, no separate parsing needed); .eml is
// parsed with mailparser and sent as plain text -- it's just structured text
// (RFC 822 headers + a text/html body), nothing like Word/Excel's opaque
// binary formats, so no vision call is needed for it at all. Word/Excel
// themselves stay unsupported: no text-extraction step for those (yet).
async function buildFileBlock({ bytes, contentType, fileName }) {
  // Prisma's driver adapter (@prisma/adapter-pg) returns Bytes columns as a
  // plain Uint8Array, not a Node Buffer -- Uint8Array has no overridden
  // toString(encoding), so bytes.toString("base64") silently produces
  // "37,80,68,70,..." (Array.prototype.toString's comma-joined decimals)
  // instead of base64. Buffer.from() wraps the same underlying data without
  // copying it, and does have the real base64 encoder.
  const buffer = Buffer.from(bytes);

  const blockType = SUPPORTED_CONTENT_TYPES[contentType];
  if (blockType) {
    const base64 = buffer.toString("base64");
    return blockType === "document"
      ? { type: "document", source: { type: "base64", media_type: contentType, data: base64 } }
      : { type: "image", source: { type: "base64", media_type: contentType, data: base64 } };
  }

  if (isEml(fileName)) {
    const parsed = await simpleParser(buffer);
    const body = parsed.text || parsed.html || "";
    if (!body.trim()) {
      const err = new Error("This email has no readable body text to scan");
      err.status = 400;
      throw err;
    }
    return { type: "text", text: `Subject: ${parsed.subject || "(no subject)"}\n\n${body}` };
  }

  const err = new Error(`Can't scan a ${contentType} file -- only PDF, JPEG, PNG, or .eml are supported`);
  err.status = 400;
  throw err;
}

async function extractRequestsFromFile(record) {
  const fileBlock = await buildFileBlock(record);

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

module.exports = { extractRequestsFromFile, isEml, ExtractionSchema };

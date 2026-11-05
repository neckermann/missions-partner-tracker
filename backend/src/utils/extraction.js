const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { simpleParser } = require("mailparser");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");

// Matches the fields PrayerRequest/SupportNeed actually need on create (see
// schema.prisma) -- dateReceived/requestDate aren't extracted, the caller
// defaults those to the source newsletter/document's own receivedDate.
// background is NOT a PrayerRequest/SupportNeed column -- it only exists so
// ExtractionReviewModal.jsx can join it with requestText/description into
// one editable block before either ever reaches the database (see that
// component's comment). Keeping it a separate model-output field here, not
// pre-joined, is what lets the verbatim rule below stay checkable: a
// reviewer can see exactly which words came from the letter and which are
// Claude's own summary.
const ExtractionSchema = z.object({
  prayerRequests: z.array(
    z.object({
      category: z.enum(["strategic", "situational"]),
      background: z.string(),
      requestText: z.string(),
    })
  ),
  oneTimeNeeds: z.array(
    z.object({
      background: z.string(),
      description: z.string(),
      // null when a specific dollar figure isn't stated -- the review UI
      // leaves that field blank rather than guessing a number.
      requestedAmount: z.number().int().positive().nullable(),
    })
  ),
});

// Strips artifacts that show up verbatim in extracted text because they're
// verbatim in the letter -- a footnote marker (bare asterisk right before
// or after the name it annotates) and the "(name changed)" parenthetical
// the footnote itself usually explains. The prompt also asks Claude not to
// copy these, but doing it here too means a prompt miss can't leak one
// through -- this runs on every request/need/background string before any
// of them reach the review modal.
function stripFootnoteArtifacts(text) {
  if (!text) return text;
  return text
    .replace(/\*(?=[A-Z])/g, "")
    .replace(/(\S)\*(?=[\s.,;:!?]|$)/g, "$1")
    .replace(/\s*\(names?\s+(?:has |have )?been\s+changed\)/gi, "")
    .replace(/\s*\(names?\s+changed\)/gi, "")
    .trim();
}

const SUPPORTED_CONTENT_TYPES = {
  "application/pdf": "document",
  "image/jpeg": "image",
  "image/png": "image",
};

const SYSTEM_PROMPT = `You read newsletters and letters from missionaries/organizations sent to their supporting church, looking for two specific things:

1. Prayer requests -- anything the writer is asking people to pray for. Mark "strategic" when it ties to the ministry's long-term vision or calling -- church planting progress, discipleship/training programs, language learning tied to ministry effectiveness, funding or partnership development, outreach campaigns, relational bridge-building with a people group. Mark "situational" for whatever came up that isn't necessarily tied to ministry vision -- illness or injury, travel safety, family needs back home, visa/paperwork issues, housing or logistics problems, a sudden personal hardship.
2. One-time financial needs -- a specific, named ask for money (not their regular monthly support), e.g. "we need $1,000 to replace our vehicle" or "please help us cover $500 in medical bills." Only include ones with an actual ask, not general statements about being low on funds. If a dollar amount is stated, extract it as a plain integer number of dollars; if the need is described without a specific figure, leave requestedAmount null rather than guessing -- but if the letter states a deadline for the need (a date, "before we leave," "by end of month"), always capture that in the background field below, even when no dollar figure is given.

Prayer requests are often indirect ("please keep lifting up my mother's health," "pray for wisdom as we plan next steps") -- read for the actual meaning, not just explicit phrases like "prayer request." A thank-you or answered-prayer note -- something already resolved, something to be grateful for -- is NOT a prayer request or a need, even if it mentions a difficult situation; only extract things still being asked for. When two or more requests are really about the same underlying situation, merge them into one request rather than returning near-duplicates. Return empty arrays for either category if nothing genuinely fits -- don't force a match.

requestText and description must be VERBATIM -- copy the exact sentence(s) stating the request/need character-for-character from the source, including the original person/pronouns ("I"/"we"/"our", never rewritten to "they"/"their"). Do not paraphrase, summarize, rephrase, or otherwise change the wording. The only edits you may make: trim down to just the sentence(s) that state the request/need itself rather than including the whole surrounding paragraph; join two non-adjacent sentences with " ... " if both are needed for the request to make sense on its own; drop a leading connector that only makes sense attached to the previous sentence ("First,", "Also,", "Finally,", "Pray too that" -> "That..."); and drop a footnote marker (a bare asterisk right before or after a name) or a "(name changed)" note. Every other word must be copied exactly as written, not reworded.

background is a SEPARATE field, 1-2 sentences, a neutral third-person summary of the situation or event behind the request/need -- written in your own words, not verbatim. Use only what the letter itself says, drawn from anywhere in it, not outside knowledge. Resolve vague references ("the teenager we mentioned," "his mother," "the application") to what they actually refer to. If multiple requests share the same underlying situation, reuse the same background for each rather than writing it once and leaving the others without context.`;

// Admin-managed in ChurchSettings -- see that field's own comment in
// schema.prisma. No implicit env-var fallback: the Anthropic SDK reads
// ANTHROPIC_API_KEY from the environment by default when constructed with
// no options, which this deliberately avoids by always passing an
// explicit apiKey, so an old env var left behind on a host can't quietly
// come back into play once the key is meant to be admin-managed.
async function client() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { anthropicApiKey: true },
  });
  if (!settings?.anthropicApiKey) {
    const err = new Error(
      "AI request scanning isn't configured -- add an API key under Site Administration → AI Features"
    );
    err.status = 400;
    throw err;
  }
  return new Anthropic({ apiKey: decryptField(settings.anthropicApiKey) });
}

// .eml's browser-reported contentType is unreliable (often
// application/octet-stream or blank -- see the same comment in
// routes/partnerFiles.js), so it's recognized by filename extension
// instead, same as upload-time validation does.
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
  const anthropic = await client();

  const response = await anthropic.messages.parse({
    model: "claude-opus-5",
    // Was 4096 -- too tight once background joined requestText/description
    // as a third field per item, long enough to truncate mid-output on a
    // letter with several requests and cause the max_tokens case below.
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: "Extract any prayer requests and one-time financial needs from this document.",
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    const err = new Error("The AI declined to process this file");
    err.status = 422;
    throw err;
  }

  // A truncated or unparseable response used to fall through to an empty
  // result, indistinguishable from "scanned fine, found nothing" -- both
  // are real possibilities (a long letter can still run out of output
  // budget even at the higher limit above; structured output isn't a hard
  // guarantee), so both are now a visible error instead of a silent empty
  // list.
  if (response.stop_reason === "max_tokens") {
    const err = new Error("This file is too long to scan in one pass -- try a shorter excerpt");
    err.status = 422;
    throw err;
  }
  if (!response.parsed_output) {
    const err = new Error("The scan didn't return a readable result -- try again");
    err.status = 422;
    throw err;
  }

  return {
    prayerRequests: response.parsed_output.prayerRequests.map((r) => ({
      ...r,
      background: stripFootnoteArtifacts(r.background),
      requestText: stripFootnoteArtifacts(r.requestText),
    })),
    oneTimeNeeds: response.parsed_output.oneTimeNeeds.map((n) => ({
      ...n,
      background: stripFootnoteArtifacts(n.background),
      description: stripFootnoteArtifacts(n.description),
    })),
  };
}

module.exports = { extractRequestsFromFile, isEml, ExtractionSchema, stripFootnoteArtifacts };

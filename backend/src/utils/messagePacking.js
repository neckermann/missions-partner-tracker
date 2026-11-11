// Splits/packs blurbs into messages under a channel's own character
// limit -- shared by groupmeChannel.js (1,000) and whatsappChannel.js
// (4,000), the two channels that pack several short blurbs into one
// message and must also split a single over-long blurb across several.
// Extracted after GroupMe's own copy silently truncated an over-long
// blurb instead of splitting it (#244), while WhatsApp's identical-in-
// spirit copy already did this correctly -- a future fix to the
// splitting rule now only needs to land in one place.

// Splits one over-long text into pieces under `max`, preferring paragraph
// breaks, then line breaks, then sentence ends, then spaces, and only as a
// last resort mid-word. Never drops or alters characters beyond trimming
// the whitespace at each split point.
function splitLongText(text, max) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const at = window.lastIndexOf(sep);
      // Don't cut so early that a tiny first piece is left behind.
      if (at >= max * 0.5) {
        cut = at + (sep === ". " ? 1 : 0);
        break;
      }
    }
    if (cut === -1) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Greedily packs blurbs into as-few messages as fit under `max`, joining
// whole blurbs with a blank line. A blurb that is itself longer than
// `max` is split into continuation messages instead of truncated.
// Returns [{ text, completes: [blurbId], partOf?: blurbId }]: `completes`
// are the blurbs fully delivered once this message lands; `partOf` marks
// every piece of a split blurb (so a failed piece skips the rest of that
// blurb and leaves it queued, rather than stamping a half-sent item).
// `textField` is the blurb property to read (both channels currently use
// the same channel-neutral `groupmeText` field -- see dispatchBlurbs.js).
function packMessages(blurbs, max, textField = "groupmeText") {
  const messages = [];
  let current = null;

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  for (const blurb of blurbs) {
    const text = blurb[textField];
    if (text.length > max) {
      flush();
      const pieces = splitLongText(text, max);
      pieces.forEach((piece, i) => {
        const last = i === pieces.length - 1;
        messages.push({ text: piece, completes: last ? [blurb.id] : [], partOf: blurb.id });
      });
      continue;
    }
    const candidate = current ? `${current.text}\n\n${text}` : text;
    if (current && candidate.length > max) {
      flush();
      current = { text, completes: [blurb.id] };
    } else {
      current = { text: candidate, completes: [...(current?.completes || []), blurb.id] };
    }
  }
  flush();
  return messages;
}

module.exports = { splitLongText, packMessages };

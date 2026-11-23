// The one reusable template for one-off (transactional) emails: welcome
// and account-setup mail, trip meeting invites and reminders, checklist
// and date-change notices. Everything renders inside the same branded
// shell as the digests (emailDispatchShell.js: church colors, logo,
// contact footer) so every message from the app looks like it came from
// the same church.
//
// Usage:
//   const { renderEmail, blocks } = require("./emailTemplate");
//   const { subject, html, text } = renderEmail({
//     settings,                       // ChurchSettings row (or null)
//     subject: "Meeting: Team kickoff",
//     eyebrow: "Meeting invite",      // small label under the church name
//     greetingName: "Sam",
//     blocks: [
//       blocks.paragraph("You're invited..."),
//       blocks.details([{ label: "When", value: "Sat, Mar 4" }]),
//       blocks.button(url, "View your trip page"),
//     ],
//     footerNote: "Small print above the church contact block.",
//   });
//
// A block is a function of the theme that returns { html, text }, so
// every block gets the church's accent color and always has a matching
// plain-text rendering (the text part is what screen readers and strict
// mail clients use). Pure -- no I/O -- so it's unit-testable.
const { buildTransactionalMessage, accentColorFor, escapeHtml, nl2br } = require("./emailDispatchShell");

const BORDER = "#e5e5e5";

function safeUrl(url) {
  const v = String(url || "").trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

const blocks = {
  // Body copy. Newlines become line breaks.
  paragraph: (text) => () => ({
    html: `<p style="margin:0 0 16px;">${nl2br(text)}</p>`,
    text: String(text),
  }),

  // Big section heading inside the body.
  heading: (text) => () => ({
    html: `<h3 style="margin:8px 0 10px;font-size:17px;line-height:1.3;color:#222;">${escapeHtml(text)}</h3>`,
    text: String(text).toUpperCase(),
  }),

  // Small grey print.
  note: (text) => () => ({
    html: `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#666;">${nl2br(text)}</p>`,
    text: String(text),
  }),

  // One call-to-action button in the church's accent color.
  button: (url, label) => (theme) => {
    const href = safeUrl(url);
    if (!href) return { html: "", text: "" };
    return {
      html: `<p style="margin:4px 0 18px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;background-color:${theme.accent};color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">${escapeHtml(label)}</a></p>`,
      text: `${label}: ${href}`,
    };
  },

  // Several side-by-side choices (e.g. RSVP Yes / No / Maybe). The first
  // is filled, the rest outlined, so the primary action stands out.
  buttonRow: (items) => (theme) => {
    const usable = items.map((i) => ({ ...i, href: safeUrl(i.url) })).filter((i) => i.href);
    if (!usable.length) return { html: "", text: "" };
    const html = usable
      .map((i, idx) =>
        idx === 0
          ? `<a href="${escapeHtml(i.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 22px;background-color:${theme.accent};color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(i.label)}</a>`
          : `<a href="${escapeHtml(i.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 21px;border:1px solid ${theme.accent};color:${theme.accent};border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(i.label)}</a>`
      )
      .join("");
    return {
      html: `<p style="margin:4px 0 16px;">${html}</p>`,
      text: usable.map((i) => `${i.label}: ${i.href}`).join("\n"),
    };
  },

  // A bordered "key facts" card: [{ label, value, href? }]. Rows with no
  // value are dropped, so callers can pass optional fields unguarded.
  details: (rows) => (theme) => {
    const usable = rows.filter((r) => r && r.value);
    if (!usable.length) return { html: "", text: "" };
    const rowsHtml = usable
      .map((r) => {
        const href = r.href ? safeUrl(r.href) : null;
        const value = href
          ? `<a href="${escapeHtml(href)}" style="color:${theme.accent};">${escapeHtml(r.value)}</a>`
          : nl2br(r.value);
        return `<tr><td style="padding:7px 14px 7px 0;font-size:12px;letter-spacing:0.4px;text-transform:uppercase;color:#888;vertical-align:top;white-space:nowrap;">${escapeHtml(r.label)}</td><td style="padding:7px 0;font-size:15px;line-height:1.5;color:#222;">${value}</td></tr>`;
      })
      .join("");
    return {
      html: `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;padding:10px 18px;background-color:#ffffff;border:1px solid ${BORDER};border-left:4px solid ${theme.accent};border-radius:10px;border-collapse:separate;">${rowsHtml}</table>`,
      text: usable.map((r) => `${r.label}: ${r.href ? `${r.value} (${r.href})` : r.value}`).join("\n"),
    };
  },

  // A short bulleted list of links: [{ label, url }]. Skips unusable URLs,
  // and renders nothing at all when none are left.
  links: (title, items) => (theme) => {
    const usable = items.map((i) => ({ ...i, href: safeUrl(i.url) })).filter((i) => i.href);
    if (!usable.length) return { html: "", text: "" };
    return {
      html: `${title ? `<p style="margin:0 0 6px;">${escapeHtml(title)}</p>` : ""}<ul style="margin:0 0 18px;padding-left:20px;">${usable
        .map(
          (i) =>
            `<li style="margin:0 0 4px;"><a href="${escapeHtml(i.href)}" style="color:${theme.accent};">${escapeHtml(i.label)}</a></li>`
        )
        .join("")}</ul>`,
      text: [...(title ? [title] : []), ...usable.map((i) => `- ${i.label}: ${i.href}`)].join("\n"),
    };
  },
};

function renderEmail({ settings, subject, eyebrow, greetingName, blocks: list, footerNote, footerLink }) {
  const theme = { accent: accentColorFor(settings) };
  const rendered = list.filter(Boolean).map((b) => b(theme));
  const message = buildTransactionalMessage({
    settings,
    subject,
    subtitleLine: eyebrow || "",
    greetingName,
    bodyHtml: rendered.map((r) => r.html).join(""),
    bodyText: rendered
      .map((r) => r.text)
      .filter(Boolean)
      .flatMap((t, i) => (i === 0 ? [t] : ["", t])),
    footerNote,
    footerLink,
  });
  return message;
}

module.exports = { renderEmail, blocks, safeUrl };

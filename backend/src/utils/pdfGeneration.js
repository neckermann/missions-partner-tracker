// Real server-side PDF generation (#252 e-signature) -- this app had zero
// PDF dependencies before this. Uses pdfkit specifically because it's pure
// JS (no headless-browser binary to run on Render's cheapest `starter`
// web-service tier, where a bundled Chromium would be a real memory risk)
// and a signed waiver is exactly what it's good at: one page of structured
// text plus an optional signature image and stamped metadata, not a
// templated multi-page layout. Deliberately NOT positioned as a future
// path for AdminBooklet.jsx's own print-based rendering -- that's built
// from real HTML/CSS templates with page-pairing/imposition logic pdfkit
// has no way to express; reusing it there would mean rewriting those
// templates from scratch in a much less productive coordinate-drawing API,
// a regression, not a reuse. If booklet ever needs true PDF output, the
// right tool for that job is a headless HTML renderer -- a separate,
// heavier decision with its own hosting-cost tradeoff, not something this
// utility pre-empts or blocks.
const PDFDocument = require("pdfkit");

// Renders one signed document: the agreement text, then a "Signed by"
// block with the signature (drawn image if present, else the typed name
// rendered as text) and the full stamped metadata. Returns a Buffer --
// the caller stores it directly on a new TripDocument row (bytes, per
// CONTRIBUTING.md's no-separate-file-storage rule), same as any manual
// upload.
//
// Everything passed in here gets rendered, deliberately not trimmed down
// -- found from a real report that the first version's metadata block
// was too sparse (truncated hash, a raw unformatted timestamp, no IP, no
// indication of which trip/requirement/participant this even was). This
// PDF is the one artifact anyone -- an admin reviewing it later, the
// signer themselves, anyone it gets forwarded to -- actually looks at;
// TripSignature's own DB row is the audit trail nobody browses directly,
// so the PDF needs to be self-contained, not a thin pointer back to data
// that lives only in the database.
function buildSignedDocumentPdf({
  requirementLabel,
  tripLabel,
  participantName,
  documentText,
  signerName,
  signatureImage,
  attestedAt,
  documentTextHash,
  ip,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(requirementLabel || "Signed Agreement", { align: "left" });
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(`${tripLabel}${participantName ? ` — ${participantName}` : ""}`);
    doc.fillColor("black");
    doc.moveDown();
    doc.fontSize(11).text(documentText, { align: "left" });
    doc.moveDown(2);

    doc.fontSize(12).text("Signed by:", { continued: false });
    doc.moveDown(0.5);

    if (signatureImage) {
      // Drawn-signature PNG -- fit to a reasonable signature-line width
      // without distorting proportions.
      doc.image(signatureImage, { fit: [220, 80] });
    } else {
      doc.font("Helvetica-Oblique").fontSize(18).text(signerName);
      doc.font("Helvetica");
    }

    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555");
    doc.text(signerName);
    doc.text(
      `Signed ${attestedAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} (${attestedAt.toISOString()})`
    );
    doc.text(`IP address: ${ip || "unknown"}`);
    // Full hash, not truncated -- a truncated hash can't actually be
    // compared against anything to verify the document wasn't altered,
    // which defeats the one real purpose a hash serves here.
    doc.text(`Document hash (SHA-256): ${documentTextHash}`);
    doc.fillColor("black");

    doc.end();
  });
}

module.exports = { buildSignedDocumentPdf };

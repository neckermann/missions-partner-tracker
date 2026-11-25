// Server-side PDF generation for e-signature. pdfkit because it's pure JS (no
// headless-browser binary, a memory risk on Render's `starter` tier) and suits a
// signed waiver: one page of text plus signature image and metadata. Not a path
// for AdminBooklet.jsx's print rendering, whose HTML/CSS templates and imposition
// logic pdfkit can't express; true PDF output there would need a headless HTML renderer.
const PDFDocument = require("pdfkit");

// Renders one signed document: the agreement text, then a "Signed by" block with
// the signature (drawn image, else the typed name) and the full stamped metadata.
// Returns a Buffer the caller stores on a new TripDocument row (bytes, per
// CONTRIBUTING.md's no-separate-file-storage rule).
//
// Everything passed in is rendered, not trimmed: this PDF is the artifact anyone
// (admin, signer, forwardee) actually looks at, while the signature audit fields
// on TripDocument are never browsed, so the PDF must be self-contained.
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
      // Drawn-signature PNG, fit to a signature-line width without distorting proportions.
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
    // Full hash, not truncated: a truncated hash can't verify the document wasn't altered.
    doc.text(`Document hash (SHA-256): ${documentTextHash}`);
    doc.fillColor("black");

    doc.end();
  });
}

module.exports = { buildSignedDocumentPdf };

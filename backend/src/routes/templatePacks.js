const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { isFeatureEnabled } = require("../utils/features");
const { recordAuditSafe } = require("../utils/auditLog");
const { KINDS, KIND_KEYS, parsePack, buildPack } = require("../utils/templatePacks");

// Template packs (see utils/templatePacks.js): import and export a church's starting points as
// plain JSON. Admin only. Importing only ever adds; nothing a church already has is deleted or
// overwritten (the one exception, email update wording, says so in its preview). Each kind needs
// the feature it belongs to (404 otherwise, like that feature's own routes).
const router = express.Router();
router.use(requireAuth);
router.use(requireRole("admin"));

async function featuresOn(handler) {
  if (!handler.requires.length) return true;
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return handler.requires.every((f) => isFeatureEnabled(settings?.enabledFeatures, f));
}

const body = z.object({ pack: z.union([z.string().max(1024 * 1024), z.record(z.string(), z.unknown())]) });

// POST /api/template-packs/preview -- checks a pack and says what importing it would do.
router.post("/preview", async (req, res, next) => {
  try {
    const { pack } = body.parse(req.body);
    const parsed = parsePack(pack);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!(await featuresOn(parsed.handler))) {
      return res
        .status(400)
        .json({ error: `Turn on the feature this belongs to first (${parsed.handler.label})` });
    }
    res.json({
      kind: parsed.pack.kind,
      kindLabel: parsed.handler.label,
      title: parsed.pack.title,
      description: parsed.pack.description,
      summary: parsed.handler.summarize(parsed.pack.data),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/template-packs/import
router.post("/import", async (req, res, next) => {
  try {
    const { pack } = body.parse(req.body);
    const parsed = parsePack(pack);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!(await featuresOn(parsed.handler))) {
      return res
        .status(400)
        .json({ error: `Turn on the feature this belongs to first (${parsed.handler.label})` });
    }
    const result = await parsed.handler.apply(parsed.pack.data, { userId: req.user.id });
    if (result.error) return res.status(400).json({ error: result.error });
    await recordAuditSafe(null, {
      action: "settings.updated",
      actor: req.user,
      entity: { type: "settings", label: "Template pack" },
      req,
      details: { imported: `${parsed.handler.label}: ${parsed.pack.title}` },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/template-packs/export/:kind[?surveyId=] -- what the church has now, as a pack to save and share.
router.get("/export/:kind", async (req, res, next) => {
  try {
    const kind = req.params.kind;
    if (!KIND_KEYS.includes(kind)) return res.status(404).json({ error: "Not found" });
    const handler = KINDS[kind];
    if (!(await featuresOn(handler))) return res.status(404).json({ error: "Not found" });
    const out = await handler.exportData({ surveyId: String(req.query.surveyId || "") });
    if (!out) return res.status(404).json({ error: "Not found" });
    const pack = buildPack(kind, out);
    const name = `${kind}-${out.title}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    res.set("Content-Type", "application/json");
    res.set("Content-Disposition", `attachment; filename="${name}.json"`);
    res.send(JSON.stringify(pack, null, 2));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

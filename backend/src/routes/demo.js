const express = require("express");
const { resetDemoData } = require("../../scripts/reset-demo-data");

const router = express.Router();

// POST /api/demo/reset — wipes and reseeds the database with fresh fake
// data. Only mounted at all if DEMO_RESET_TOKEN is set (see server.js) —
// absent in every normal deployment, so this route doesn't exist there.
router.post("/reset", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== process.env.DEMO_RESET_TOKEN) {
      return res.status(401).json({ error: "Invalid token" });
    }

    await resetDemoData();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

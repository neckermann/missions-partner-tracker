const express = require("express");
const crypto = require("crypto");
const { resetDemoData } = require("../../scripts/reset-demo-data");

const router = express.Router();

// Constant-time compare: `!==` on secrets leaks timing. timingSafeEqual throws
// on mismatched lengths, so length is checked first.
function safeTokenMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Wipes and reseeds the database with fake data. Only mounted when
// DEMO_RESET_TOKEN is set (see server.js), so it doesn't exist in normal deployments.
router.post("/reset", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || !safeTokenMatch(token, process.env.DEMO_RESET_TOKEN)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    await resetDemoData();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

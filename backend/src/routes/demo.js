const express = require("express");
const crypto = require("crypto");
const { resetDemoData } = require("../../scripts/reset-demo-data");

const router = express.Router();

// Plain `!==` on secrets leaks a timing side-channel (it stops comparing at
// the first mismatched byte, so a closer guess takes measurably longer) —
// crypto.timingSafeEqual always compares every byte, in constant time,
// regardless of where the mismatch is. It throws on mismatched lengths
// rather than returning false, so that's checked first.
function safeTokenMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/demo/reset — wipes and reseeds the database with fresh fake
// data. Only mounted at all if DEMO_RESET_TOKEN is set (see server.js) —
// absent in every normal deployment, so this route doesn't exist there.
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

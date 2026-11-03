const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource. The partner record's own PUT no longer accepts
// a trips array, so this router is the only way in -- turning the feature
// off now actually turns it off.
router.use(requireFeature("trips"));

// The only writer for Trip (+ its TripParticipant children). Backs both the
// consolidated "Trip History" admin page and the trips section on a single
// partner's page -- logging or correcting a trip against any partner
// without loading and resubmitting their whole record.
const participantSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const tripSchema = z.object({
  partnerId: z.string(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  albumProvider: z.enum(["google_photos", "icloud", "other"]).optional().nullable(),
  albumUrl: z.string().optional().nullable(),
  participants: z.array(participantSchema).optional(),
});

// Same "presence in this request, not null-ness" reasoning as the
// approved-pair/answered-date checks in supportNeeds.js/prayerRequests.js
// -- a partial PUT that only touches one of the two dates (correcting just
// the end date, say) is left alone; this only catches a request that
// supplies both and gets their order backwards.
function datesInOrder(data) {
  if (!data.startDate || !data.endDate) return true;
  return data.endDate >= data.startDate;
}
const DATE_ORDER_ISSUE = { message: "endDate cannot be before startDate", path: ["endDate"] };

// A link to an album the admin already maintains elsewhere (Google Photos,
// iCloud Shared Album, etc.) -- never in-app file storage, see #130.
// Deliberately lenient per-provider shape checks, not strict URL parsing --
// matches this app's existing "light validation" stance on every other
// link field (websiteLink, supportLink, ... have none at all); this is a
// scoped exception for this one field, not a precedent to retrofit
// elsewhere. Unlike datesInOrder, a half-filled pair (provider with no
// url, or url with no provider) is never valid on its own -- only "both
// absent" passes through, which is what keeps this safe for a partial PUT
// that doesn't touch either field (both come through as undefined/falsy).
const ALBUM_URL_PATTERNS = {
  google_photos: /^https:\/\/photos\.(app\.goo\.gl|google\.com)\//i,
  icloud: /^https:\/\/(www\.)?icloud\.com\/(sharedalbum|photos)\//i,
  other: /^https?:\/\/.+\..+/, // deliberately permissive
};
function albumLinkValid(data) {
  if (!data.albumProvider && !data.albumUrl) return true;
  if (!data.albumProvider || !data.albumUrl) return false;
  return ALBUM_URL_PATTERNS[data.albumProvider].test(data.albumUrl.trim());
}
const ALBUM_LINK_ISSUE = {
  message: "Enter a valid album link for the selected provider",
  path: ["albumUrl"],
};

// GET /api/trips's own ?year= filter -- z.coerce.number().int() so an
// invalid value 400s instead of silently being dropped (Number(bad) is
// NaN, and the old `if (Number.isInteger(year))` guard just skipped
// filtering on it with no error), same coercion discipline
// reports/tripHistory.js already uses for the same concept.
const tripQuerySchema = z.object({
  partnerId: z.string().optional(),
  tripType: z.string().optional(),
  year: z.coerce.number().int().optional(),
});

const tripInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
  participants: true,
};

// GET /api/trips?partnerId=&tripType=&year=  (all partners combined,
// most recent first). Previously the Trip History page had to fetch every
// missionary and every organization with all their relations and flatten
// the result in the browser; this replaces that with one query.
router.get("/", async (req, res, next) => {
  try {
    const query = tripQuerySchema.parse(req.query);
    const where = {};
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.tripType) where.tripType = query.tripType;
    if (query.year) {
      where.startDate = {
        gte: new Date(Date.UTC(query.year, 0, 1)),
        lt: new Date(Date.UTC(query.year + 1, 0, 1)),
      };
    }

    const records = await prisma.trip.findMany({
      where,
      include: tripInclude,
      orderBy: { startDate: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);
    const created = await prisma.trip.create({
      data: {
        ...data,
        participants: participants?.length ? { create: participants } : undefined,
      },
      include: tripInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/:id  (update — editor or admin). Every field is editable,
// including moving the trip to a different partner, which is now just a
// plain column. Participants, when included in the request, are replaced
// wholesale (delete then recreate) rather than diffed -- simpler than
// tracking which participant row is "the same person" across an edit, and
// they carry nothing (no id references, no timestamps) that recreating
// them loses.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema
      .partial()
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);

    const existing = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      if (participants !== undefined) {
        await tx.tripParticipant.deleteMany({ where: { tripId: req.params.id } });
      }
      return tx.trip.update({
        where: { id: req.params.id },
        data: {
          ...data,
          participants: participants !== undefined ? { create: participants } : undefined,
        },
        include: tripInclude,
      });
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/trips/:id  (admin only). Cascades to its participants.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.trip.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    await prisma.trip.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

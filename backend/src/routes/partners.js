const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { withPhotoUrls } = require("../utils/photoUrls");
const { geocodeAddress } = require("../utils/geocode");
const { matchesFileSignature } = require("../utils/fileSignature");
const { flattenSendingParty, shapeSendingParties } = require("../utils/sendingParty");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Composes the two post-query response transforms this route file needs:
// sending-party shaping (see utils/sendingParty.js) and turning each Photo
// row's id into the `url` the frontend expects (see utils/photoUrls.js).
function shapePartner(p) {
  return shapeSendingParties({ ...p, photos: withPhotoUrls(p.photos) });
}

const IMAGE_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIME_TO_EXT[file.mimetype]) {
      const err = new Error("Only JPEG, PNG, or WebP images are allowed");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// Surfaces multer errors (bad file type, too large) as 400s instead of 500s.
function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

// What GET /:id returns: the partner record itself plus the small
// one-per-partner relations that are genuinely part of it and are only
// ever written through this route.
//
// Deliberately NOT the history collections (trips, support entries,
// one-time needs, prayer requests, newsletters, documents). Those are
// independent resources with their own endpoints, and each section of the
// partner page loads the one it needs -- a list row shouldn't drag ten
// years of history across the wire to render a name.
const partnerRecordInclude = {
  adults: true,
  children: true,
  sendingParties: true,
  addresses: true,
  furloughs: { orderBy: { startDate: "desc" } },
  churchVisits: { orderBy: { visitDate: "desc" } },
  // Full history, newest-received first — photos[0] is "current". Bytes are
  // never wanted here; the image comes from routes/photos.js.
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], omit: { bytes: true } },
};

// What GET / returns per row: enough to render a list, and nothing more.
// Each partner previously came back with thirteen relations eagerly loaded
// even when the caller only needed a name and a country.
const partnerSummarySelect = {
  id: true,
  kind: true,
  displayName: true,
  fieldDisplayName: true,
  fipsCountryCode: true,
  orgType: true,
  isPublic: true,
  isRestricted: true,
  archived: true,
  sentByOurChurch: true,
  supportingSince: true,
  overviewShort: true,
  focusArea: true,
  // Trip-hosting capacity: five small scalars, kept in the summary because
  // the Trip Opportunities page filters on exactly these and nothing else.
  tripTeamSizeMin: true,
  tripTeamSizeMax: true,
  tripTypesSupported: true,
  tripSeasonNotes: true,
  tripLogisticsNotes: true,
  addresses: {
    where: { type: "physical" },
    select: { city: true, stateProvinceRegion: true, country: true, gpsLat: true, gpsLng: true },
  },
  // "Current" monthly support is just the latest row by effectiveDate.
  supportEntries: {
    orderBy: { effectiveDate: "desc" },
    take: 1,
    select: { amount: true, effectiveDate: true },
  },
  photos: {
    orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: { id: true, receivedDate: true },
  },
  // "Last visit" is just the latest row, same idea as current support.
  churchVisits: {
    orderBy: { visitDate: "desc" },
    take: 1,
    select: { visitDate: true },
  },
};

// A partner has at most one address per type: "physical" (actual serving
// location — may be a full street address or just city/state/country, and
// is the source of the public map pin via gpsLat/gpsLng) and "mailing"
// (US-side contact/support-mail address, no coordinates).
const addressFieldsSchema = z.object({
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  gpsLat: z.number().optional().nullable(),
  gpsLng: z.number().optional().nullable(),
  receiveMail: z.boolean().optional().nullable(),
  receivePackages: z.boolean().optional().nullable(),
});
const addressesSchema = z
  .object({
    physical: addressFieldsSchema.optional(),
    mailing: addressFieldsSchema.optional(),
  })
  .optional();

// Shared shape for the sendingChurch/sendingOrg API fields. Explicit
// fields (rather than z.any()) so Zod strips relation-managed keys like
// `id`/`partnerId` that the frontend round-trips back from a GET response
// — the nested-write helpers reject those as unknown columns otherwise.
// `mailingAddress` stays a nested object in the API contract even though
// the database stores it as flat columns (see SendingParty in
// schema.prisma and utils/sendingParty.js, shared with
// routes/publicPartners.js).
const sendingPartySchema = z
  .object({
    name: z.string().optional().nullable(),
    contactName: z.string().optional().nullable(),
    contactEmail: z.string().optional().nullable(),
    websiteLink: z.string().optional().nullable(),
    mailingAddress: addressFieldsSchema
      .pick({
        addressLine1: true,
        addressLine2: true,
        city: true,
        stateProvinceRegion: true,
        postalCode: true,
        country: true,
      })
      .optional()
      .nullable(),
    phone: z.string().optional().nullable(),
  })
  .optional();

// A period off the field, at home. endDate is left optional/nullable for
// an open-ended/ongoing furlough.
const furloughSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// A single visit to the church. "Last visit" is read off whichever entry
// has the latest visitDate.
const churchVisitSchema = z.object({
  visitDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

// One schema for both kinds. The kind-specific fields are all optional, so
// an organization simply never sends the missionary-only ones and vice
// versa — the same arrangement the database uses (nullable columns and
// naturally-empty relations) rather than two parallel schemas.
const partnerSchema = z.object({
  kind: z.enum(["missionary", "organization"]),
  displayName: z.string().min(1),
  fieldDisplayName: z.string().optional().nullable(),
  fipsCountryCode: z.string().optional().nullable(),
  isPublic: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  preferredContactMethod: z.string().optional().nullable(),
  overview: z.string().optional().nullable(),
  overviewShort: z.string().optional().nullable(),
  focusArea: z.string().optional().nullable(),
  websiteLink: z.string().optional().nullable(),
  supportLink: z.string().optional().nullable(),
  newsletterSignup: z.string().optional().nullable(),
  facebook: z.string().optional().nullable(),
  twitter: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  supportingSince: z.coerce.date().optional().nullable(),
  tripTeamSizeMin: z.coerce.number().int().optional().nullable(),
  tripTeamSizeMax: z.coerce.number().int().optional().nullable(),
  tripTypesSupported: z.array(z.string()).optional(),
  tripSeasonNotes: z.string().optional().nullable(),
  tripLogisticsNotes: z.string().optional().nullable(),

  // --- Organization-only ---
  orgType: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),

  // --- Missionary-only ---
  contactSafe: z.boolean().optional(),
  sentByOurChurch: z.boolean().optional(),
  anniversary: z.coerce.date().optional().nullable(),
  languagesSpoken: z.array(z.string()).optional(),
  emergencyContact: z.any().optional(),
  adults: z
    .array(
      z.object({
        name: z.string(),
        phone1: z.string().optional().nullable(),
        phone2: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        birthday: z.coerce.date().optional().nullable(),
      })
    )
    .optional(),
  children: z.array(z.object({ name: z.string(), birthday: z.coerce.date().optional().nullable() })).optional(),
  sendingChurch: sendingPartySchema,
  sendingOrg: sendingPartySchema,

  // --- Shared sub-records written through this route ---
  addresses: addressesSchema,
  furloughs: z.array(furloughSchema).optional(),
  churchVisits: z.array(churchVisitSchema).optional(),
});

// Converts the { physical, mailing } shape used by the API into the row
// array Prisma's addresses relation expects, dropping any type that wasn't
// actually filled in (rather than persisting an all-empty address row).
//
// If a physical address is given without GPS coordinates, this tries to
// fill them in via forward geocoding (city/state/country -> lat/lng) as a
// convenience. A failed or empty geocode result just leaves gpsLat/gpsLng
// null — it never blocks the save.
async function buildAddressRows(addresses) {
  if (!addresses) return undefined;
  const rows = [];
  if (addresses.physical) {
    let physical = addresses.physical;
    if (physical.gpsLat == null && physical.gpsLng == null) {
      const geocoded = await geocodeAddress(physical);
      if (geocoded) physical = { ...physical, gpsLat: geocoded.lat, gpsLng: geocoded.lng };
    }
    rows.push({ type: "physical", ...physical });
  }
  if (addresses.mailing) rows.push({ type: "mailing", ...addresses.mailing });
  return rows;
}

// GET /api/partners  (list — summary rows only)
// Optional ?kind=missionary|organization, ?archived=true|false (omit for
// both), ?q= name/field search.
//
// ?include=full opts into the deep record for every partner instead. The
// printed booklet is the one screen that genuinely needs that -- it lays
// out each partner's family, addresses, sending party and prayer requests
// in one document -- and N+1 detail requests would be worse. It's an
// explicit, single-caller escape hatch, deliberately not the default.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.archived === "true") where.archived = true;
    if (req.query.archived === "false") where.archived = false;
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { fieldDisplayName: { contains: q, mode: "insensitive" } },
      ];
    }

    if (req.query.include === "full") {
      const full = await prisma.partner.findMany({
        where,
        include: {
          ...partnerRecordInclude,
          prayerRequests: { orderBy: { dateReceived: "desc" } },
        },
        orderBy: { displayName: "asc" },
      });
      return res.json(full.map(shapePartner));
    }

    const records = await prisma.partner.findMany({
      where,
      select: partnerSummarySelect,
      orderBy: { displayName: "asc" },
    });
    res.json(records.map((r) => ({ ...r, photos: withPhotoUrls(r.photos) })));
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/:id  (the record and its one-per-partner relations —
// see partnerRecordInclude for why the history collections aren't here)
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: partnerRecordInclude,
    });
    if (!record) return res.status(404).json({ error: "Not found" });
    res.json(shapePartner(record));
  } catch (err) {
    next(err);
  }
});

// POST /api/partners  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = partnerSchema.parse(req.body);
    const { adults, children, sendingChurch, sendingOrg, addresses, furloughs, churchVisits, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);
    const sendingPartyRows = [
      ...(sendingChurch ? [flattenSendingParty(sendingChurch, "church")] : []),
      ...(sendingOrg ? [flattenSendingParty(sendingOrg, "org")] : []),
    ];

    const created = await prisma.partner.create({
      data: {
        ...scalarData,
        createdById: req.user.id,
        updatedById: req.user.id,
        adults: adults ? { create: adults } : undefined,
        children: children ? { create: children } : undefined,
        sendingParties: sendingPartyRows.length ? { create: sendingPartyRows } : undefined,
        addresses: addressRows?.length ? { create: addressRows } : undefined,
        furloughs: furloughs ? { create: furloughs } : undefined,
        churchVisits: churchVisits ? { create: churchVisits } : undefined,
      },
      include: partnerRecordInclude,
    });

    res.status(201).json(shapePartner(created));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    next(err);
  }
});

// POST /api/partners/:id/image (upload photo — editor or admin)
// Adds a new Photo row rather than overwriting one — the previous current
// photo becomes history instead of being deleted, so it can be viewed or
// individually removed later (see DELETE /:id/photos/:photoId below).
router.post(
  "/:id/image",
  requireRole("admin", "editor"),
  upload.single("image"),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });
      if (!matchesFileSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File content doesn't match its declared image type" });
      }

      const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      // Defaults to today, same as the newsletter upload's receivedDate —
      // lets an admin backfill an older photo with its real date instead.
      const receivedDate = req.body.receivedDate ? new Date(req.body.receivedDate) : new Date();

      await prisma.photo.create({
        data: {
          partnerId: req.params.id,
          bytes: req.file.buffer,
          receivedDate,
          contentType: req.file.mimetype,
          fileSize: req.file.size,
        },
      });

      const updated = await prisma.partner.update({
        where: { id: req.params.id },
        data: { updatedById: req.user.id },
        include: partnerRecordInclude,
      });

      res.json(shapePartner(updated));
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/partners/:id/photos/:photoId (admin only — same permission
// level as deleting a newsletter). Deletes one photo from history; if it
// was the current one, whichever photo has the next-latest receivedDate
// becomes current automatically.
router.delete("/:id/photos/:photoId", requireRole("admin"), async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.photoId },
      select: { partnerId: true },
    });
    if (!photo || photo.partnerId !== req.params.id) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.photo.delete({ where: { id: req.params.photoId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PUT /api/partners/:id (update — editor or admin)
//
// Handles the partner record and the sub-records this route is the *only*
// writer for: adults, children, addresses, sending parties, furloughs and
// church visits. Those are still replaced wholesale when their key is
// present, which is safe precisely because nothing else writes them.
//
// Trips, support entries, one-time needs, prayer requests, newsletters and
// documents are deliberately NOT accepted here, even if the client sends
// them. Each has its own per-row endpoint, and accepting them here meant
// deleting and recreating every row on each save — which churned their ids,
// reset their timestamps, and silently destroyed any row added through the
// other endpoint since the client last loaded the record.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = partnerSchema.partial().parse(req.body);
    const { adults, children, sendingChurch, sendingOrg, addresses, furloughs, churchVisits, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);

    const updated = await prisma.$transaction(async (tx) => {
      if (adults) await tx.adult.deleteMany({ where: { partnerId: req.params.id } });
      if (children) await tx.child.deleteMany({ where: { partnerId: req.params.id } });
      if (addressRows) await tx.address.deleteMany({ where: { partnerId: req.params.id } });
      if (furloughs) await tx.furlough.deleteMany({ where: { partnerId: req.params.id } });
      if (churchVisits) await tx.churchVisit.deleteMany({ where: { partnerId: req.params.id } });
      // sendingChurch/sendingOrg are handled independently of each other —
      // each is only touched if its own field was actually sent.
      if (sendingChurch) await tx.sendingParty.deleteMany({ where: { partnerId: req.params.id, type: "church" } });
      if (sendingOrg) await tx.sendingParty.deleteMany({ where: { partnerId: req.params.id, type: "org" } });

      const sendingPartyRows = [
        ...(sendingChurch ? [flattenSendingParty(sendingChurch, "church")] : []),
        ...(sendingOrg ? [flattenSendingParty(sendingOrg, "org")] : []),
      ];

      return tx.partner.update({
        where: { id: req.params.id },
        data: {
          ...scalarData,
          updatedById: req.user.id,
          adults: adults ? { create: adults } : undefined,
          children: children ? { create: children } : undefined,
          sendingParties: sendingPartyRows.length ? { create: sendingPartyRows } : undefined,
          addresses: addressRows?.length ? { create: addressRows } : undefined,
          furloughs: furloughs ? { create: furloughs } : undefined,
          churchVisits: churchVisits ? { create: churchVisits } : undefined,
        },
        include: partnerRecordInclude,
      });
    });

    res.json(shapePartner(updated));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

// POST /api/partners/:id/archive (editor or admin) — the "soft delete".
// Pulls the record out of public data (isPublic: false), zeros out monthly
// support by adding a new $0 SupportEntry (never edits/removes old entries,
// so support history stays intact), and flags it archived so it drops out
// of the default admin list view.
router.post("/:id/archive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportEntry.create({
        data: {
          partnerId: req.params.id,
          amount: 0,
          effectiveDate: new Date(),
          notes: "Support zeroed on archive",
        },
      });
      return tx.partner.update({
        where: { id: req.params.id },
        data: { archived: true, archivedAt: new Date(), isPublic: false, updatedById: req.user.id },
        include: partnerRecordInclude,
      });
    });

    res.json(shapePartner(updated));
  } catch (err) {
    next(err);
  }
});

// POST /api/partners/:id/unarchive (editor or admin) — reverses archive.
// Does not restore isPublic or re-add support on its own; those are
// deliberate decisions to make again once someone's actually back.
router.post("/:id/unarchive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const updated = await prisma.partner.update({
      where: { id: req.params.id },
      data: { archived: false, archivedAt: null, updatedById: req.user.id },
      include: partnerRecordInclude,
    });
    res.json(shapePartner(updated));
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

// DELETE /api/partners/:id (admin only). Only permitted once a record has
// been archived — archiving is the deliberate first step, so a record can't
// be permanently removed in a single click.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.partner.findUnique({
      where: { id: req.params.id },
      select: { archived: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!existing.archived) {
      return res.status(400).json({ error: "Archive this partner before deleting it." });
    }
    // Cascades to newsletters/documents/photos/addresses/etc. — their file
    // bytes live in the same row (see the Newsletter model comment in
    // schema.prisma), so there's no separate external cleanup needed.
    await prisma.partner.delete({ where: { id: req.params.id } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

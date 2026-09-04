const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { uploadImageToS3, deleteFromS3IfOwned, deleteFromS3ByKey } = require("../utils/s3");
const { geocodeAddress } = require("../utils/geocode");
const { matchesFileSignature } = require("../utils/fileSignature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

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

const missionaryInclude = {
  adults: true,
  children: true,
  sendingChurch: true,
  sendingOrg: true,
  addresses: true,
  missionTrips: { include: { participants: true } },
  furloughs: { orderBy: { startDate: "desc" } },
  churchVisits: { orderBy: { visitDate: "desc" } },
  supportEntries: { orderBy: { effectiveDate: "desc" } },
  needRequests: { orderBy: { requestDate: "desc" } },
  newsletters: { orderBy: { receivedDate: "desc" } },
  documents: { orderBy: { receivedDate: "desc" } },
  // Full history, newest-received first — photos[0] is "current". Admin-
  // only (the public API takes just the first row; see maskData.js).
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }] },
};

// Shared shape for SendingChurch/SendingOrg. Explicit fields (rather than
// z.any()) so Zod strips relation-managed keys like `id`/`missionaryId` that
// the frontend round-trips back from a GET response — Prisma's nested
// upsert rejects those as unknown arguments otherwise.
const sendingPartySchema = z
  .object({
    name: z.string().optional().nullable(),
    contactName: z.string().optional().nullable(),
    contactEmail: z.string().optional().nullable(),
    websiteLink: z.string().optional().nullable(),
    mailingAddress: z.any().optional().nullable(),
    phone: z.string().optional().nullable(),
  })
  .optional();

// A missionary has at most one address per type: "physical" (actual serving
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

const tripParticipantSchema = z.object({
  name: z.string(),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});
const missionTripSchema = z.object({
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  participants: z.array(tripParticipantSchema).optional(),
});

// A single point-in-time monthly support amount. Never validated against
// prior entries (e.g. requiring dates to be unique/ordered) — admins may
// want to backfill or correct history, and the "current" amount is always
// just whichever entry has the latest effectiveDate.
const supportEntrySchema = z.object({
  amount: z.coerce.number().int().nonnegative(),
  effectiveDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

// A one-time need request and (once decided) our response to it.
// approvedAmount/approvedDate are left optional/nullable since a need may
// still be pending a decision.
const supportNeedSchema = z.object({
  description: z.string().min(1),
  requestedAmount: z.coerce.number().int().nonnegative(),
  requestDate: z.coerce.date(),
  approvedAmount: z.coerce.number().int().nonnegative().optional().nullable(),
  approvedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// A period off the field, at home. endDate is left optional/nullable for
// an open-ended/ongoing furlough.
const furloughSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// A single visit to the church. "Last visit" is read off whichever entry
// has the latest visitDate, same idea as supportEntrySchema's "current".
const churchVisitSchema = z.object({
  visitDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

// Loose validation — tighten as your fields stabilize.
const missionarySchema = z.object({
  displayName: z.string().min(1),
  fieldDisplayName: z.string().optional().nullable(),
  fipsCountryCode: z.string().optional().nullable(),
  isPublic: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  contactSafe: z.boolean().optional(),
  sentByOurChurch: z.boolean().optional(),
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
  anniversary: z.coerce.date().optional().nullable(),
  languagesSpoken: z.array(z.string()).optional(),
  tripTeamSizeMin: z.coerce.number().int().optional().nullable(),
  tripTeamSizeMax: z.coerce.number().int().optional().nullable(),
  tripTypesSupported: z.array(z.string()).optional(),
  tripSeasonNotes: z.string().optional().nullable(),
  tripLogisticsNotes: z.string().optional().nullable(),
  missionTrips: z.array(missionTripSchema).optional(),
  furloughs: z.array(furloughSchema).optional(),
  churchVisits: z.array(churchVisitSchema).optional(),
  supportEntries: z.array(supportEntrySchema).optional(),
  needRequests: z.array(supportNeedSchema).optional(),
  addresses: addressesSchema,
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
  children: z
    .array(z.object({ name: z.string(), birthday: z.coerce.date().optional().nullable() }))
    .optional(),
  sendingChurch: sendingPartySchema,
  sendingOrg: sendingPartySchema,
});

// GET /api/missionaries  (list, full data, any logged-in role)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.missionary.findMany({
      include: missionaryInclude,
      orderBy: { displayName: "asc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/missionaries/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.missionary.findUnique({
      where: { id: req.params.id },
      include: missionaryInclude,
    });
    if (!record) return res.status(404).json({ error: "Not found" });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// POST /api/missionaries  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = missionarySchema.parse(req.body);
    const {
      adults,
      children,
      sendingChurch,
      sendingOrg,
      addresses,
      missionTrips,
      furloughs,
      churchVisits,
      supportEntries,
      needRequests,
      ...scalarData
    } = data;
    const addressRows = await buildAddressRows(addresses);

    const created = await prisma.missionary.create({
      data: {
        ...scalarData,
        createdById: req.user.id,
        updatedById: req.user.id,
        adults: adults ? { create: adults } : undefined,
        children: children ? { create: children } : undefined,
        sendingChurch: sendingChurch ? { create: sendingChurch } : undefined,
        sendingOrg: sendingOrg ? { create: sendingOrg } : undefined,
        addresses: addressRows?.length ? { create: addressRows } : undefined,
        missionTrips: missionTrips
          ? {
              create: missionTrips.map(({ participants, ...trip }) => ({
                ...trip,
                participants: participants ? { create: participants } : undefined,
              })),
            }
          : undefined,
        furloughs: furloughs ? { create: furloughs } : undefined,
        churchVisits: churchVisits ? { create: churchVisits } : undefined,
        supportEntries: supportEntries ? { create: supportEntries } : undefined,
        needRequests: needRequests ? { create: needRequests } : undefined,
      },
      include: missionaryInclude,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/missionaries/:id/image (upload headshot — editor or admin)
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

      const existing = await prisma.missionary.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      // Defaults to today, same as the newsletter upload's receivedDate —
      // lets an admin backfill an older photo with its real date instead.
      const receivedDate = req.body.receivedDate ? new Date(req.body.receivedDate) : new Date();

      const ext = IMAGE_MIME_TO_EXT[req.file.mimetype];
      const key = `missionaries/${req.params.id}/headshot-${Date.now()}.${ext}`;
      const url = await uploadImageToS3(req.file.buffer, key, req.file.mimetype);

      await prisma.photo.create({
        data: {
          missionaryId: req.params.id,
          url,
          receivedDate,
          contentType: req.file.mimetype,
          fileSize: req.file.size,
          createdById: req.user.id,
        },
      });

      const updated = await prisma.missionary.update({
        where: { id: req.params.id },
        data: { updatedById: req.user.id },
        include: missionaryInclude,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/missionaries/:id/photos/:photoId (admin only — same
// permission level as deleting a newsletter). Deletes one photo from
// history; if it was the current one, whichever photo has the
// next-latest receivedDate becomes current automatically.
router.delete("/:id/photos/:photoId", requireRole("admin"), async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.photoId } });
    if (!photo || photo.missionaryId !== req.params.id) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.photo.delete({ where: { id: req.params.photoId } });
    deleteFromS3IfOwned(photo.url).catch((err) =>
      console.error("Failed to clean up photo file after delete:", err)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PUT /api/missionaries/:id (update — editor or admin)
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = missionarySchema.partial().parse(req.body);
    const {
      adults,
      children,
      sendingChurch,
      sendingOrg,
      addresses,
      missionTrips,
      furloughs,
      churchVisits,
      supportEntries,
      needRequests,
      ...scalarData
    } = data;
    const addressRows = await buildAddressRows(addresses);

    // Adults/children/addresses/missionTrips/furloughs/churchVisits/
    // supportEntries/needRequests are replaced wholesale on edit for
    // simplicity. (A more granular per-record PATCH can be added later if
    // needed.) Deleting a MissionTrip cascades to its participants.
    const updated = await prisma.$transaction(async (tx) => {
      if (adults) {
        await tx.adult.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (children) {
        await tx.child.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (addressRows) {
        await tx.address.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (missionTrips) {
        await tx.missionTrip.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (furloughs) {
        await tx.furlough.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (churchVisits) {
        await tx.churchVisit.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (supportEntries) {
        await tx.supportEntry.deleteMany({ where: { missionaryId: req.params.id } });
      }
      if (needRequests) {
        await tx.supportNeed.deleteMany({ where: { missionaryId: req.params.id } });
      }

      return tx.missionary.update({
        where: { id: req.params.id },
        data: {
          ...scalarData,
          updatedById: req.user.id,
          adults: adults ? { create: adults } : undefined,
          children: children ? { create: children } : undefined,
          sendingChurch: sendingChurch
            ? { upsert: { create: sendingChurch, update: sendingChurch } }
            : undefined,
          sendingOrg: sendingOrg
            ? { upsert: { create: sendingOrg, update: sendingOrg } }
            : undefined,
          addresses: addressRows?.length ? { create: addressRows } : undefined,
          missionTrips: missionTrips
            ? {
                create: missionTrips.map(({ participants, ...trip }) => ({
                  ...trip,
                  participants: participants ? { create: participants } : undefined,
                })),
              }
            : undefined,
          furloughs: furloughs ? { create: furloughs } : undefined,
          churchVisits: churchVisits ? { create: churchVisits } : undefined,
          supportEntries: supportEntries ? { create: supportEntries } : undefined,
          needRequests: needRequests ? { create: needRequests } : undefined,
        },
        include: missionaryInclude,
      });
    });

    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/missionaries/:id/archive (editor or admin) — the "soft delete".
// Pulls the record out of public data (isPublic: false), zeros out monthly
// support by adding a new $0 SupportEntry (never edits/removes old entries,
// so support history stays intact), and flags it archived so it drops out
// of the default admin list view.
router.post("/:id/archive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.missionary.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportEntry.create({
        data: {
          missionaryId: req.params.id,
          amount: 0,
          effectiveDate: new Date(),
          notes: "Support zeroed on archive",
        },
      });
      return tx.missionary.update({
        where: { id: req.params.id },
        data: { archived: true, archivedAt: new Date(), isPublic: false, updatedById: req.user.id },
        include: missionaryInclude,
      });
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/missionaries/:id/unarchive (editor or admin) — reverses archive.
// Does not restore isPublic or re-add support on its own; those are
// deliberate decisions to make again once someone's actually back.
router.post("/:id/unarchive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const updated = await prisma.missionary.update({
      where: { id: req.params.id },
      data: { archived: false, archivedAt: null, updatedById: req.user.id },
      include: missionaryInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/missionaries/:id (admin only). Only permitted once a record
// has been archived — archiving is the deliberate first step, so a record
// can't be permanently removed in a single click.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.missionary.findUnique({
      where: { id: req.params.id },
      include: { newsletters: true, documents: true, photos: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!existing.archived) {
      return res.status(400).json({ error: "Archive this missionary before deleting it." });
    }
    await prisma.missionary.delete({ where: { id: req.params.id } });

    // The DB delete cascades to newsletters/documents/photos/addresses/etc.,
    // but none of that touches S3 — clean up every photo (not just the
    // current one) and any newsletter/document files here so a deleted
    // missionary doesn't leave orphaned objects in the bucket.
    existing.photos.forEach((p) => {
      deleteFromS3IfOwned(p.url).catch((err) =>
        console.error("Failed to clean up photo after delete:", err)
      );
    });
    existing.newsletters.forEach((n) => {
      deleteFromS3ByKey(n.fileKey).catch((err) =>
        console.error("Failed to clean up newsletter file after delete:", err)
      );
    });
    existing.documents.forEach((d) => {
      deleteFromS3ByKey(d.fileKey).catch((err) =>
        console.error("Failed to clean up document file after delete:", err)
      );
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

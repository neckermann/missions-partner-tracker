const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { uploadImageToS3, deleteFromS3IfOwned, deleteFromS3ByKey } = require("../utils/s3");
const { geocodeAddress } = require("../utils/geocode");

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

const organizationInclude = {
  addresses: true,
  orgTrips: { include: { participants: true } },
  churchVisits: { orderBy: { visitDate: "desc" } },
  supportEntries: { orderBy: { effectiveDate: "desc" } },
  needRequests: { orderBy: { requestDate: "desc" } },
  newsletters: { orderBy: { receivedDate: "desc" } },
  // Full history, newest-received first — photos[0] is "current". Admin-
  // only (the public API takes just the first row; see maskData.js).
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }] },
};

// An organization has at most one address per type — same "physical" (the
// source of the public map pin) / "mailing" split as Missionary addresses.
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

// Same shape/behavior as buildAddressRows in routes/missionaries.js: converts
// { physical, mailing } into the row array Prisma's addresses relation
// expects, auto-geocoding the physical address (city/state/country only —
// never street-level) when no manual GPS was given.
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
const orgTripSchema = z.object({
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  participants: z.array(tripParticipantSchema).optional(),
});

// Same shape as in routes/missionaries.js — see the comments there.
const supportEntrySchema = z.object({
  amount: z.coerce.number().int().nonnegative(),
  effectiveDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});
const supportNeedSchema = z.object({
  description: z.string().min(1),
  requestedAmount: z.coerce.number().int().nonnegative(),
  requestDate: z.coerce.date(),
  approvedAmount: z.coerce.number().int().nonnegative().optional().nullable(),
  approvedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Same shape as in routes/missionaries.js — see the comment there.
const churchVisitSchema = z.object({
  visitDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
});

const organizationSchema = z.object({
  name: z.string().min(1),
  orgType: z.string().min(1), // "Local" | "National"
  fieldDisplayName: z.string().optional().nullable(),
  fipsCountryCode: z.string().optional().nullable(),
  isPublic: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  overview: z.string().optional().nullable(),
  overviewShort: z.string().optional().nullable(),
  focusArea: z.string().optional().nullable(),
  supportingSince: z.coerce.date().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  preferredContactMethod: z.string().optional().nullable(),
  websiteLink: z.string().optional().nullable(),
  supportLink: z.string().optional().nullable(),
  newsletterSignup: z.string().optional().nullable(),
  facebook: z.string().optional().nullable(),
  twitter: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  tripTeamSizeMin: z.coerce.number().int().optional().nullable(),
  tripTeamSizeMax: z.coerce.number().int().optional().nullable(),
  tripTypesSupported: z.array(z.string()).optional(),
  tripSeasonNotes: z.string().optional().nullable(),
  tripLogisticsNotes: z.string().optional().nullable(),
  orgTrips: z.array(orgTripSchema).optional(),
  churchVisits: z.array(churchVisitSchema).optional(),
  supportEntries: z.array(supportEntrySchema).optional(),
  needRequests: z.array(supportNeedSchema).optional(),
  addresses: addressesSchema,
});

// GET /api/organizations  (list, full data, any logged-in role)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.organization.findMany({
      include: organizationInclude,
      orderBy: { name: "asc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/organizations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: organizationInclude,
    });
    if (!record) return res.status(404).json({ error: "Not found" });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// POST /api/organizations  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = organizationSchema.parse(req.body);
    const { addresses, orgTrips, churchVisits, supportEntries, needRequests, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);

    const created = await prisma.organization.create({
      data: {
        ...scalarData,
        createdById: req.user.id,
        updatedById: req.user.id,
        addresses: addressRows?.length ? { create: addressRows } : undefined,
        orgTrips: orgTrips
          ? {
              create: orgTrips.map(({ participants, ...trip }) => ({
                ...trip,
                participants: participants ? { create: participants } : undefined,
              })),
            }
          : undefined,
        churchVisits: churchVisits ? { create: churchVisits } : undefined,
        supportEntries: supportEntries ? { create: supportEntries } : undefined,
        needRequests: needRequests ? { create: needRequests } : undefined,
      },
      include: organizationInclude,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/organizations/:id/image (upload logo — editor or admin)
// Adds a new Photo row rather than overwriting one — see the mirrored
// route in routes/missionaries.js for the full rationale.
router.post(
  "/:id/image",
  requireRole("admin", "editor"),
  upload.single("image"),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });

      const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      const receivedDate = req.body.receivedDate ? new Date(req.body.receivedDate) : new Date();

      const ext = IMAGE_MIME_TO_EXT[req.file.mimetype];
      const key = `organizations/${req.params.id}/logo-${Date.now()}.${ext}`;
      const url = await uploadImageToS3(req.file.buffer, key, req.file.mimetype);

      await prisma.photo.create({
        data: {
          organizationId: req.params.id,
          url,
          receivedDate,
          contentType: req.file.mimetype,
          fileSize: req.file.size,
          createdById: req.user.id,
        },
      });

      const updated = await prisma.organization.update({
        where: { id: req.params.id },
        data: { updatedById: req.user.id },
        include: organizationInclude,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/organizations/:id/photos/:photoId (admin only) — see the
// mirrored route in routes/missionaries.js.
router.delete("/:id/photos/:photoId", requireRole("admin"), async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.photoId } });
    if (!photo || photo.organizationId !== req.params.id) {
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

// PUT /api/organizations/:id (update — editor or admin)
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = organizationSchema.partial().parse(req.body);
    const { addresses, orgTrips, churchVisits, supportEntries, needRequests, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);

    // Addresses/trips/church visits/support entries/needs are replaced
    // wholesale on edit, same as missionaries.
    const updated = await prisma.$transaction(async (tx) => {
      if (addressRows) {
        await tx.organizationAddress.deleteMany({ where: { organizationId: req.params.id } });
      }
      if (orgTrips) {
        await tx.organizationTrip.deleteMany({ where: { organizationId: req.params.id } });
      }
      if (churchVisits) {
        await tx.churchVisit.deleteMany({ where: { organizationId: req.params.id } });
      }
      if (supportEntries) {
        await tx.supportEntry.deleteMany({ where: { organizationId: req.params.id } });
      }
      if (needRequests) {
        await tx.supportNeed.deleteMany({ where: { organizationId: req.params.id } });
      }

      return tx.organization.update({
        where: { id: req.params.id },
        data: {
          ...scalarData,
          updatedById: req.user.id,
          addresses: addressRows?.length ? { create: addressRows } : undefined,
          orgTrips: orgTrips
            ? {
                create: orgTrips.map(({ participants, ...trip }) => ({
                  ...trip,
                  participants: participants ? { create: participants } : undefined,
                })),
              }
            : undefined,
          churchVisits: churchVisits ? { create: churchVisits } : undefined,
          supportEntries: supportEntries ? { create: supportEntries } : undefined,
          needRequests: needRequests ? { create: needRequests } : undefined,
        },
        include: organizationInclude,
      });
    });

    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// POST /api/organizations/:id/archive (editor or admin) — see the mirrored
// route in routes/missionaries.js for the full rationale.
router.post("/:id/archive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportEntry.create({
        data: {
          organizationId: req.params.id,
          amount: 0,
          effectiveDate: new Date(),
          notes: "Support zeroed on archive",
        },
      });
      return tx.organization.update({
        where: { id: req.params.id },
        data: { archived: true, archivedAt: new Date(), isPublic: false, updatedById: req.user.id },
        include: organizationInclude,
      });
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/organizations/:id/unarchive (editor or admin)
router.post("/:id/unarchive", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const updated = await prisma.organization.update({
      where: { id: req.params.id },
      data: { archived: false, archivedAt: null, updatedById: req.user.id },
      include: organizationInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/organizations/:id (admin only). Only permitted once a record
// has been archived — see the mirrored route in routes/missionaries.js.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: { newsletters: true, photos: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!existing.archived) {
      return res.status(400).json({ error: "Archive this organization before deleting it." });
    }
    await prisma.organization.delete({ where: { id: req.params.id } });

    // The DB delete cascades to newsletters/photos/addresses/etc., but none
    // of that touches S3 — clean up every logo (not just the current one)
    // and any newsletter files here so a deleted organization doesn't leave
    // orphaned objects in the bucket.
    existing.photos.forEach((p) => {
      deleteFromS3IfOwned(p.url).catch((err) =>
        console.error("Failed to clean up logo after delete:", err)
      );
    });
    existing.newsletters.forEach((n) => {
      deleteFromS3ByKey(n.fileKey).catch((err) =>
        console.error("Failed to clean up newsletter file after delete:", err)
      );
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

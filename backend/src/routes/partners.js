const express = require("express");
const { z } = require("zod");
const { CONTACT_METHODS, CONTACT_LEVELS } = require("../utils/contactMethods");
const prisma = require("../prismaClient");
const { recordAudit, recordRestrictedView } = require("../utils/auditLog");
const { latestOf, partnerLastUpdated, listFields } = require("../utils/lastUpdated");
const { sendingChurchPartnerWhere, listSendingChurches } = require("../utils/sendingChurch");

const { isFeatureEnabled } = require("../utils/features");
const { requireAuth, requireRole, requirePartnerWriter } = require("../middleware/requireAuth");
const { canReadPartner, readablePartnerIds } = require("../utils/guestAccess");
const { withPhotoUrls } = require("../utils/photoUrls");
const { geocodeAddress } = require("../utils/geocode");
const { matchesFileSignature } = require("../utils/fileSignature");
const heicConvert = require("heic-convert");
const { flattenSendingParty, shapeSendingParties } = require("../utils/sendingParty");
const { makeExtResolver, uploadFilteredBy } = require("../utils/upload");
const { countriesInContinent } = require("../utils/countryContinents");
const { LINK_TYPES } = require("./linkTypes");
const { PROFICIENCY_LEVELS } = require("./proficiencyLevels");

const router = express.Router();
router.use(requireAuth);

// Composes the two post-query response transforms: sending-party shaping (utils/sendingParty.js)
// and Photo id -> `url` (utils/photoUrls.js).
function shapePartner(p) {
  return shapeSendingParties({ ...p, photos: withPhotoUrls(p.photos) });
}

const IMAGE_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

// HEIC/HEIF and webp have no reliable browser-reported MIME type (Windows often reports
// octet-stream or blank), so both are recognized by extension, as with .eml in partnerFiles.js.
const resolveImageExt = makeExtResolver(IMAGE_MIME_TO_EXT, [
  { test: (name) => /\.hei[cf]$/i.test(name), ext: "heic" },
  { test: (name) => /\.webp$/i.test(name), ext: "webp" },
]);

const upload = uploadFilteredBy(resolveImageExt, {
  maxFileSize: 5 * 1024 * 1024,
  message: "Only JPEG, PNG, WebP, or HEIC/HEIF images are allowed",
});

// What GET /:id returns: the partner plus the one-per-partner relations only written through
// this route. History collections (trips, support entries, needs, prayer requests, files, adults,
// children, furloughs, church visits, links, languages, trip types) are deliberately excluded;
// each has its own endpoint.
const partnerRecordInclude = {
  sendingParties: true,
  addresses: true,
  // Full history, newest-received first; photos[0] is current. Bytes live in their own table and
  // are never selected here; the image comes from routes/photos.js.
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }] },
};

// What GET / returns per row: enough to render a list and nothing more.
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
  // Trip-hosting capacity, kept in the summary because the Trip
  // Opportunities page filters on exactly these and nothing else.
  tripTeamSizeMin: true,
  tripTeamSizeMax: true,
  tripTypes: { select: { type: true } },
  tripSeasonNotes: true,
  tripLogisticsNotes: true,
  addresses: {
    where: { type: "physical" },
    select: { type: true, city: true, stateProvinceRegion: true, country: true, gpsLat: true, gpsLng: true },
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

// Shared shape for sendingChurch/sendingOrg. Explicit fields (not z.any()) so Zod strips
// relation-managed keys like `id`/`partnerId` that the frontend round-trips. `mailingAddress` is
// a nested object in the API but flat columns in the DB (see SendingParty in schema.prisma).
const sendingPartySchema = z
  .object({
    name: z.string().optional().nullable(),
    contactFirstName: z.string().optional().nullable(),
    contactLastName: z.string().optional().nullable(),
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

// One schema for both kinds; kind-specific fields are optional. Scalars and the addresses/
// sendingChurch/sendingOrg sub-records only, shared by POST and PUT. adults/children/furloughs/
// churchVisits/links/languages are NOT here (own endpoints): sending them on PUT is a silent
// no-op because Zod drops unknown keys.
const partnerSchema = z.object({
  kind: z.enum(["missionary", "organization"]),
  displayName: z.string().min(1),
  fieldDisplayName: z.string().optional().nullable(),
  fipsCountryCode: z.string().optional().nullable(),
  isPublic: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  overview: z.string().optional().nullable(),
  overviewShort: z.string().optional().nullable(),
  focusArea: z.string().optional().nullable(),
  supportingSince: z.coerce.date().optional().nullable(),
  adoptedAt: z.coerce.date().optional().nullable(),
  commissionedAt: z.coerce.date().optional().nullable(),
  lastPrayedWithCongregationAt: z.coerce.date().optional().nullable(),
  tripTeamSizeMin: z.coerce.number().int().optional().nullable(),
  tripTeamSizeMax: z.coerce.number().int().optional().nullable(),
  tripSeasonNotes: z.string().optional().nullable(),
  tripLogisticsNotes: z.string().optional().nullable(),

  // --- Organization-only ---
  orgType: z.string().optional().nullable(),
  contactFirstName: z.string().optional().nullable(),
  contactLastName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  contactMethod: z.enum(CONTACT_METHODS).optional().nullable(),
  contactMethodNote: z.string().trim().max(200).optional().nullable(),

  // --- Missionary-only ---
  // How careful to be when reaching them, and the guidelines and go-between that go with it.
  contactLevel: z.enum(CONTACT_LEVELS).optional(),
  contactChannels: z.array(z.enum(CONTACT_METHODS)).optional(),
  contactInstructions: z.string().trim().max(2000).optional().nullable(),
  contactViaName: z.string().trim().max(200).optional().nullable(),
  contactViaRole: z.string().trim().max(200).optional().nullable(),
  contactViaPhone: z.string().trim().max(100).optional().nullable(),
  contactViaEmail: z.string().trim().max(200).optional().nullable(),
  sentByOurChurch: z.boolean().optional(),
  anniversary: z.coerce.date().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactEmail: z.string().optional().nullable(),
  sendingChurch: sendingPartySchema,
  sendingOrg: sendingPartySchema,

  // --- Shared sub-records written through this route ---
  addresses: addressesSchema,
});

const adultSchema = z.object({
  firstName: z.string(),
  lastName: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  birthday: z.coerce.date().optional().nullable(),
});
const childSchema = z.object({
  firstName: z.string(),
  lastName: z.string().optional().nullable(),
  birthday: z.coerce.date().optional().nullable(),
});
const partnerLinkSchema = z.object({ type: z.enum(LINK_TYPES), url: z.string().min(1) });
const partnerLanguageSchema = z.object({
  language: z.string().min(1),
  proficiency: z.enum(PROFICIENCY_LEVELS).optional().nullable(),
});
const tripTypeSchema = z.object({ type: z.string().min(1) });

// POST-only: a new partner's household/furlough history/links/languages are known upfront
// (Wizard.jsx), so creation accepts them as nested arrays; PUT does not.
const partnerCreateSchema = partnerSchema.extend({
  adults: z.array(adultSchema).optional(),
  children: z.array(childSchema).optional(),
  furloughs: z.array(furloughSchema).optional(),
  churchVisits: z.array(churchVisitSchema).optional(),
  links: z.array(partnerLinkSchema).optional(),
  languages: z.array(partnerLanguageSchema).optional(),
  tripTypes: z.array(tripTypeSchema).optional(),
});

// Converts the API's { physical, mailing } shape into the row array Prisma's addresses relation
// expects, dropping empty types. A physical address without GPS is forward-geocoded; a failed
// or empty geocode leaves gpsLat/gpsLng null and never blocks the save.
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

// "Sent by {church}" means this partner's Sending Church IS this church, so every field is
// overwritten with Church Settings' current values. Also backs POST /sync-sending-church.
// Unchecking never clears anything. ChurchSettings' address columns match SendingParty's flat
// shape for a direct copy.
async function syncSendingChurch(client, partnerId) {
  const settings = await client.churchSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return;

  const filled = {
    name: settings.churchName || null,
    contactFirstName: settings.contactFirstName || null,
    contactLastName: settings.contactLastName || null,
    contactEmail: settings.contactEmail || null,
    phone: settings.phone || null,
    websiteLink: settings.websiteLink || null,
    addressLine1: settings.addressLine1 || null,
    addressLine2: settings.addressLine2 || null,
    city: settings.city || null,
    stateProvinceRegion: settings.stateProvinceRegion || null,
    postalCode: settings.postalCode || null,
    country: settings.country || null,
  };

  await client.sendingParty.upsert({
    where: { partnerId_type: { partnerId, type: "church" } },
    create: { partnerId, type: "church", ...filled },
    update: filled,
  });
}

// GET /api/partners  (list — summary rows only)
// Filters: ?kind, ?archived (omit for both), ?q, ?isPublic, ?restricted, ?country, ?continent
// (resolved via utils/countryContinents.js; not a stored column).
// ?include=full returns the deep record per partner: the printed booklet's single-caller escape
// hatch, not the default.
// A Trip Leader gets only their own trip's partner via GET /:id: an outright role block here,
// since a collection route has no :id for requireTripScope.
// GET /api/partners/reachable -- the partners this login may read, as just
// enough for a picker ({ id, kind, displayName, archived, isRestricted }).
// For a guest that's exactly the partners their active grants reach (#289);
// every other role reaches all of them. Registered before "/:id" so
// "reachable" isn't read as a partner id.
router.get("/reachable", async (req, res, next) => {
  try {
    const ids = readablePartnerIds(req.user);
    const records = await prisma.partner.findMany({
      where: ids ? { id: { in: ids } } : {},
      select: { id: true, kind: true, displayName: true, archived: true, isRestricted: true },
      orderBy: { displayName: "asc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// A guest (#289) lists the same directory as everyone, limited by the server
// to the partners they reach, and without the one thing they never see:
// money (the current monthly support amount, and "supporting since").
const { supportEntries: _s, supportingSince: _ss, ...guestSummarySelect } = partnerSummarySelect;

// GET /api/partners/sending-churches -- the options for the "Sending church" filter
// used on every list about partners (ours first, then each other church, with
// counts). Staff only: a guest has no use for the list of every church.
router.get("/sending-churches", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    res.json(await listSendingChurches());
  } catch (err) {
    next(err);
  }
});

router.get("/", requireRole("admin", "editor", "viewer", "guest"), async (req, res, next) => {
  try {
    const where = {};
    const reachable = readablePartnerIds(req.user);
    if (reachable) {
      // The booklet's full dump is staff/viewer only.
      if (req.query.include === "full") return res.status(403).json({ error: "Insufficient permissions" });
      where.id = { in: reachable };
    }
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.archived === "true") where.archived = true;
    if (req.query.archived === "false") where.archived = false;
    if (req.query.isPublic === "true") where.isPublic = true;
    if (req.query.isPublic === "false") where.isPublic = false;
    if (req.query.restricted === "true") where.isRestricted = true;
    if (req.query.restricted === "false") where.isRestricted = false;
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { fieldDisplayName: { contains: q, mode: "insensitive" } },
      ];
    }
    Object.assign(where, sendingChurchPartnerWhere(req.query.sendingChurch) || {});
    if (req.query.country) {
      where.addresses = { some: { type: "physical", country: String(req.query.country) } };
    } else if (req.query.continent) {
      const countries = countriesInContinent(String(req.query.continent));
      where.addresses = { some: { type: "physical", country: { in: countries } } };
    }

    if (req.query.include === "full") {
      // The booklet is the only caller, so this honours the same two toggles the booklet screen
      // does; otherwise a church with Prayer Requests off would still serve every prayer request
      // (including private ones) to any logged-in user.
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      });
      if (!isFeatureEnabled(settings?.enabledFeatures, "booklet")) {
        return res.status(404).json({ error: "Not found" });
      }

      const full = await prisma.partner.findMany({
        where,
        include: {
          ...partnerRecordInclude,
          // Independent resources, so not in partnerRecordInclude, but the booklet needs all of them.
          adults: true,
          children: true,
          furloughs: { orderBy: { startDate: "desc" } },
          churchVisits: { orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }] },
          links: true,
          languages: true,
          ...(isFeatureEnabled(settings?.enabledFeatures, "prayerRequests")
            ? { prayerRequests: { orderBy: { dateReceived: "desc" } } }
            : {}),
        },
        orderBy: { displayName: "asc" },
      });
      return res.json(full.map(shapePartner));
    }

    const records = await prisma.partner.findMany({
      where,
      select: reachable ? guestSummarySelect : partnerSummarySelect,
      orderBy: { displayName: "asc" },
    });
    // When each partner (or any section of it) was last changed -- staff only; a
    // guest's list carries no editor names.
    const updated = reachable ? null : await partnerLastUpdated(records.map((r) => r.id));
    res.json(
      records.map((r) => ({
        ...r,
        photos: withPhotoUrls(r.photos),
        ...(updated ? listFields(updated.get(r.id)) : {}),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/:id  (the record and its one-per-partner relations —
// see partnerRecordInclude for why the history collections aren't here)
router.get("/:id", async (req, res, next) => {
  try {
    // Guest tier: read-only, and only partners their active grants reach. requireAuth re-reads
    // grants each request, so revocation takes effect immediately.
    if (!canReadPartner(req.user, req.params.id)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const record = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: partnerRecordInclude,
    });
    if (!record) return res.status(404).json({ error: "Not found" });
    // The line under the name reads "last edited": the latest change to the
    // partner or to any section on its page (family, addresses, links...).
    const shown = latestOf([
      { at: record.lastEditedAt, name: record.lastEditedByName },
      (await partnerLastUpdated([record.id])).get(record.id),
    ]);
    if (shown) {
      record.lastEditedAt = shown.at;
      record.lastEditedByName = shown.name;
    }
    // A look at a restricted partner is logged (once per person per day); a
    // failure to log must never stop the page loading.
    if (record.isRestricted) {
      await recordRestrictedView({ viewer: req.user, partner: record, req }).catch((err) =>
        console.error("Couldn't record a restricted-partner view:", err.message)
      );
    }
    res.json(shapePartner(record));
  } catch (err) {
    next(err);
  }
});

// POST /api/partners  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = partnerCreateSchema.parse(req.body);
    const {
      adults,
      children,
      sendingChurch,
      sendingOrg,
      addresses,
      furloughs,
      churchVisits,
      links,
      languages,
      tripTypes,
      ...scalarData
    } = data;
    const addressRows = await buildAddressRows(addresses);
    const sendingPartyRows = [
      ...(sendingChurch ? [flattenSendingParty(sendingChurch, "church")] : []),
      ...(sendingOrg ? [flattenSendingParty(sendingOrg, "org")] : []),
    ];

    let created = await prisma.partner.create({
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
        links: links ? { create: links } : undefined,
        languages: languages ? { create: languages } : undefined,
        tripTypes: tripTypes ? { create: tripTypes } : undefined,
      },
      include: partnerRecordInclude,
    });

    // Same sync as PUT /:id; always runs when checked: Church Settings wins even if this create
    // also sent its own sendingChurch data.
    if (scalarData.sentByOurChurch === true) {
      await syncSendingChurch(prisma, created.id);
      created = await prisma.partner.findUnique({ where: { id: created.id }, include: partnerRecordInclude });
    }

    res.status(201).json(shapePartner(created));
  } catch (err) {
    next(err);
  }
});

// POST /api/partners/:id/image (upload photo — editor or admin)
// Adds a new Photo row; the previous current photo becomes history (see DELETE /:id/photos/:photoId).
router.post(
  "/:id/image",
  requirePartnerWriter({ param: "id" }),
  upload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });

      const ext = resolveImageExt(req.file);
      // Verified against the canonical type for the resolved extension, not req.file.mimetype, which
      // cannot be trusted for HEIC/webp (see resolveImageExt).
      const signatureMime = ext === "heic" ? "image/heic" : ext === "webp" ? "image/webp" : req.file.mimetype;
      if (!matchesFileSignature(req.file.buffer, signatureMime)) {
        return res.status(400).json({ error: "File content doesn't match its declared image type" });
      }

      let bytes = req.file.buffer;
      // Also what gets stored, so the served Content-Type is always correct.
      let contentType = signatureMime;
      let fileSize = req.file.size;

      // HEIC does not render in <img> outside Safari, so it is transcoded to JPEG rather than stored.
      if (ext === "heic") {
        try {
          bytes = await heicConvert({ buffer: req.file.buffer, format: "JPEG", quality: 0.9 });
        } catch {
          return res.status(400).json({
            error: "Couldn't read this HEIC file — it may be corrupted or use an unsupported variant",
          });
        }
        contentType = "image/jpeg";
        fileSize = bytes.length;
      }

      const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      // Defaults to today; lets an admin backfill an older photo with its real date. Uses
      // z.coerce.date() like other date-only writes (this route is multipart, not Zod-validated).
      const receivedDate = z.coerce
        .date()
        .optional()
        .default(() => new Date())
        .parse(req.body.receivedDate);

      await prisma.photo.create({
        data: {
          partnerId: req.params.id,
          receivedDate,
          contentType,
          fileSize,
          bytesRow: { create: { bytes } },
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

// DELETE /api/partners/:id/photos/:photoId (admin only). If the deleted photo was current, the
// photo with the next-latest receivedDate becomes current.
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
// Sole writer for the partner record, addresses and sending parties; the latter are replaced
// wholesale when their key is present, safe because each type has at most one row per partner
// (@@unique([partnerId, type])). Trips, support entries, needs, prayer requests, files, adults,
// children, furloughs, church visits, links, languages and trip types are NOT accepted here (Zod
// drops the keys): each has its own per-row endpoint, and replacing them wholesale would churn
// ids and destroy rows added elsewhere.
router.put("/:id", requirePartnerWriter({ param: "id" }), async (req, res, next) => {
  try {
    const data = partnerSchema.partial().parse(req.body);
    const { sendingChurch, sendingOrg, addresses, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);

    // Read before the transaction to compare against scalarData.sentByOurChurch below.
    const before = await prisma.partner.findUnique({
      where: { id: req.params.id },
      select: { sentByOurChurch: true, isRestricted: true, displayName: true },
    });
    if (!before) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      if (addressRows) await tx.address.deleteMany({ where: { partnerId: req.params.id } });
      // sendingChurch/sendingOrg are handled independently of each other —
      // each is only touched if its own field was actually sent.
      if (sendingChurch)
        await tx.sendingParty.deleteMany({ where: { partnerId: req.params.id, type: "church" } });
      if (sendingOrg) await tx.sendingParty.deleteMany({ where: { partnerId: req.params.id, type: "org" } });

      const sendingPartyRows = [
        ...(sendingChurch ? [flattenSendingParty(sendingChurch, "church")] : []),
        ...(sendingOrg ? [flattenSendingParty(sendingOrg, "org")] : []),
      ];

      const result = await tx.partner.update({
        where: { id: req.params.id },
        data: {
          ...scalarData,
          updatedById: req.user.id,
          sendingParties: sendingPartyRows.length ? { create: sendingPartyRows } : undefined,
          addresses: addressRows?.length ? { create: addressRows } : undefined,
        },
        include: partnerRecordInclude,
      });

      // Transition-based, not presence-based: runs only when this save turns sentByOurChurch on. An
      // absent `sendingChurch` key cannot signal this, because the checkbox lives inside the Sending
      // Church box and every real save sends both. Church Settings' values win over this save's own
      // sendingChurch payload; no merge.
      // Restricting (or un-restricting) a partner changes who can see where they
      // are, so it is its own entry in the audit trail.
      if (scalarData.isRestricted !== undefined && scalarData.isRestricted !== before.isRestricted) {
        await recordAudit(tx, {
          action: "partner.restricted_changed",
          actor: req.user,
          entity: { type: "partner", id: req.params.id, label: result.displayName },
          req,
          details: { isRestricted: { from: before.isRestricted, to: scalarData.isRestricted } },
        });
      }

      if (scalarData.sentByOurChurch === true && !before.sentByOurChurch) {
        await syncSendingChurch(tx, req.params.id);
        return tx.partner.findUnique({ where: { id: req.params.id }, include: partnerRecordInclude });
      }
      return result;
    });

    res.json(shapePartner(updated));
  } catch (err) {
    next(err);
  }
});

// POST /api/partners/sync-sending-church (admin only) — bulk counterpart to the per-partner
// sync: re-pulls Church Settings into every sent-by-us partner. Admin-only since it rewrites
// every such partner. Deliberately not one $transaction: each partner's sync is atomic, it is
// idempotent and re-runnable, and many partners could exceed Prisma's default transaction timeout.
router.post("/sync-sending-church", requireRole("admin"), async (req, res, next) => {
  try {
    const partners = await prisma.partner.findMany({
      where: { sentByOurChurch: true },
      select: { id: true },
    });
    for (const p of partners) {
      await syncSendingChurch(prisma, p.id);
    }
    res.json({ updatedCount: partners.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/partners/:id/archive (editor or admin) — the "soft delete".
// Pulls the record out of public data (isPublic: false), zeros out monthly
// support by adding a new $0 SupportEntry (never edits/removes old entries,
// so support history stays intact), and flags it archived so it drops out
// of the default admin list view.
router.post("/:id/archive", requirePartnerWriter({ param: "id" }), async (req, res, next) => {
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
router.post("/:id/unarchive", requirePartnerWriter({ param: "id" }), async (req, res, next) => {
  try {
    const updated = await prisma.partner.update({
      where: { id: req.params.id },
      data: { archived: false, archivedAt: null, updatedById: req.user.id },
      include: partnerRecordInclude,
    });
    res.json(shapePartner(updated));
  } catch (err) {
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
      select: { archived: true, displayName: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!existing.archived) {
      return res.status(400).json({ error: "Archive this partner before deleting it." });
    }
    // Cascades to files/photos/addresses; file bytes live in the same database, so no external cleanup.
    await prisma.$transaction(async (tx) => {
      await tx.partner.delete({ where: { id: req.params.id } });
      await recordAudit(tx, {
        action: "partner.deleted",
        actor: req.user,
        entity: { type: "partner", id: req.params.id, label: existing.displayName },
        req,
      });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

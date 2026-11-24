const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("../utils/features");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { canReadPartner } = require("../utils/guestAccess");
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
  "image/heic": "heic",
  "image/heif": "heic",
};

// HEIC/HEIF (the default photo format on every iPhone since iOS 11) has no
// reliable browser-reported MIME type -- Windows in particular has no
// built-in HEIC registration, so Chrome/Edge there often report
// application/octet-stream or leave it blank. webp's Content-Type isn't
// always reliable either (confirmed directly -- see routes/settings.js's
// own logo upload for the same fix). Both recognized by extension as a
// fallback, same approach as .eml in routes/partnerFiles.js.
const resolveImageExt = makeExtResolver(IMAGE_MIME_TO_EXT, [
  { test: (name) => /\.hei[cf]$/i.test(name), ext: "heic" },
  { test: (name) => /\.webp$/i.test(name), ext: "webp" },
]);

const upload = uploadFilteredBy(resolveImageExt, {
  maxFileSize: 5 * 1024 * 1024,
  message: "Only JPEG, PNG, WebP, or HEIC/HEIF images are allowed",
});

// What GET /:id returns: the partner record itself plus the small
// one-per-partner relations that are genuinely part of it and are only
// ever written through this route.
//
// Deliberately NOT the history collections (trips, support entries,
// one-time needs, prayer requests, partner files, adults, children,
// furloughs, church visits, links, languages, trip types). Those are
// independent resources with their own endpoints, and each section of
// the partner page loads the one it needs -- a list row shouldn't drag
// ten years of history across the wire to render a name.
const partnerRecordInclude = {
  sendingParties: true,
  addresses: true,
  // Full history, newest-received first — photos[0] is "current". Bytes
  // are never wanted here (they live in their own table now, never
  // selected unless explicitly included); the image comes from
  // routes/photos.js.
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }] },
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

// One schema for both kinds. The kind-specific fields are all optional, so
// an organization simply never sends the missionary-only ones and vice
// versa — the same arrangement the database uses (nullable columns and
// naturally-empty relations) rather than two parallel schemas.
// Scalars and the addresses/sendingChurch/sendingOrg sub-records only --
// shared by both POST and PUT. adults/children/furloughs/churchVisits/
// links/languages are deliberately NOT here: each is its own resource with
// its own endpoint (see routes/adults.js etc.), same as trips/support
// entries/one-time needs/prayer requests/partner files already were. PUT
// uses this schema directly, so sending any of those six on an update is a
// silent no-op (Zod drops unrecognized keys) rather than touching them.
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
  supportingSince: z.coerce.date().optional().nullable(),
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

  // --- Missionary-only ---
  contactSafe: z.boolean().optional(),
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

// POST-only: a brand-new partner's household/furlough history/links/
// languages are normally known upfront (see Wizard.jsx's own comment on
// why "New Partner" bundles these at creation, unlike a Trip's team), so
// creation still accepts them as nested arrays -- same convenience as
// before, just no longer also accepted on every subsequent PUT.
const partnerCreateSchema = partnerSchema.extend({
  adults: z.array(adultSchema).optional(),
  children: z.array(childSchema).optional(),
  furloughs: z.array(furloughSchema).optional(),
  churchVisits: z.array(churchVisitSchema).optional(),
  links: z.array(partnerLinkSchema).optional(),
  languages: z.array(partnerLanguageSchema).optional(),
  tripTypes: z.array(tripTypeSchema).optional(),
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

// Checking "Sent by {church}" (in the Sending Church box itself) means this
// partner's Sending Church IS this church -- so every field is replaced
// with Church Settings' current value, no matter what's already there. The
// same function backs the explicit "Update them all with this info" bulk
// action (POST /sync-sending-church) below, for pushing a later Church
// Settings change out to every partner already marked sent-by-us.
// Unchecking never clears anything; this only ever runs on the way in.
// ChurchSettings' address columns are deliberately the same flat shape as
// SendingParty's own (see that comment in schema.prisma) for exactly this
// direct a copy.
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
// Optional ?kind=missionary|organization, ?archived=true|false (omit for
// both), ?q= name/field search, ?isPublic=true|false, ?restricted=true|false,
// ?country= exact physical-address country, ?continent= (resolved to a
// country list via utils/countryContinents.js, since continent itself
// isn't a stored column).
//
// ?include=full opts into the deep record for every partner instead. The
// printed booklet is the one screen that genuinely needs that -- it lays
// out each partner's family, addresses, sending party and prayer requests
// in one document -- and N+1 detail requests would be worse. It's an
// explicit, single-caller escape hatch, deliberately not the default.
// A Trip Leader has no access to the directory at all -- only ever their
// own one trip's own linked Partner, read-only, via GET /:id below. No
// requireTripScope here (there's no single :id to check against a
// collection route), just an outright role block.
router.get("/", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const where = {};
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
    if (req.query.country) {
      where.addresses = { some: { type: "physical", country: String(req.query.country) } };
    } else if (req.query.continent) {
      const countries = countriesInContinent(String(req.query.continent));
      where.addresses = { some: { type: "physical", country: { in: countries } } };
    }

    if (req.query.include === "full") {
      // The booklet is the only caller, so this branch honours the same two
      // toggles the booklet screen does. Without this, turning off Print
      // booklet did nothing server-side, and -- worse -- a church that had
      // turned Prayer Requests off still served every prayer request here,
      // including the private and situational ones, to any logged-in user.
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
          // These six are independent resources now (see partnerRecordInclude's
          // own comment) and so aren't in it by default, but the booklet
          // genuinely needs all of them to lay out each partner's page.
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
    // Guest tier: read-only, and only partners their active grants reach
    // (today: the partner of each granted trip) -- "they can view the
    // partner details page as part of that," not the directory at large.
    // Resolved fresh each request by requireAuth, same revocation-takes-
    // effect-immediately reasoning as its role re-read.
    if (!canReadPartner(req.user, req.params.id)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
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

    // Same sync as PUT /:id -- see syncSendingChurch. Always runs when
    // checked, even if this same create also sent its own sendingChurch
    // data -- checking the box means Church Settings wins, full stop.
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
// Adds a new Photo row rather than overwriting one — the previous current
// photo becomes history instead of being deleted, so it can be viewed or
// individually removed later (see DELETE /:id/photos/:photoId below).
router.post("/:id/image", requireRole("admin", "editor"), upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image file provided" });

    const ext = resolveImageExt(req.file);
    // Verified against the canonical type for the resolved extension, not
    // req.file.mimetype directly -- a HEIC or webp upload's own
    // Content-Type can't always be trusted (see resolveImageExt's
    // comment), so the signature check needs to know what it's actually
    // supposed to be.
    const signatureMime = ext === "heic" ? "image/heic" : ext === "webp" ? "image/webp" : req.file.mimetype;
    if (!matchesFileSignature(req.file.buffer, signatureMime)) {
      return res.status(400).json({ error: "File content doesn't match its declared image type" });
    }

    let bytes = req.file.buffer;
    // Also what actually gets stored, so a served photo's Content-Type
    // header is always correct regardless of what the upload itself
    // claimed -- same reasoning as the signature check above.
    let contentType = signatureMime;
    let fileSize = req.file.size;

    // HEIC doesn't render in an <img> tag in most browsers outside Safari
    // (Chrome/Firefox/Edge on Windows and Android can't display it), so
    // it's transcoded to JPEG here rather than stored as-is -- nothing
    // downstream (display, the public site, VERIFIED_INLINE_TYPES in
    // utils/fileResponse.js) ever needs to know a HEIC file was involved.
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

    // Defaults to today, same as the newsletter upload's receivedDate —
    // lets an admin backfill an older photo with its real date instead.
    // Same z.coerce.date() mechanism every other date-only write in this
    // app uses, even though this route isn't otherwise Zod-validated (it's
    // multer/multipart, not a JSON body schema).
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
});

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
// writer for: addresses and sending parties. Those are still replaced
// wholesale when their key is present, which is safe precisely because
// each type has at most one row per partner (@@unique([partnerId, type]))
// -- there's no "add a new one without touching the other" case the way
// there is for a growing list.
//
// Trips, support entries, one-time needs, prayer requests, partner
// files, adults, children, furloughs, church visits, links, languages,
// and trip types are deliberately NOT accepted here, even if the client
// sends them (Zod silently drops unrecognized keys). Each has its own
// per-row endpoint, and accepting them here meant deleting and
// recreating every row on each save — which churned their ids, reset
// their timestamps, and silently destroyed any row added through the
// other endpoint since the client last loaded the record.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = partnerSchema.partial().parse(req.body);
    const { sendingChurch, sendingOrg, addresses, ...scalarData } = data;
    const addressRows = await buildAddressRows(addresses);

    // Read before the transaction, specifically to compare against
    // scalarData.sentByOurChurch below -- see the comment on that check.
    const before = await prisma.partner.findUnique({
      where: { id: req.params.id },
      select: { sentByOurChurch: true },
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

      // Transition-based, not presence-based: only when this save is the
      // one actually turning sentByOurChurch on (it was false/unset going
      // in). Checking for an absent `sendingChurch` key used to stand in
      // for "this save didn't already touch Sending Church," but the
      // checkbox lives inside the Sending Church box itself now (see that
      // component's comment in AdminPartnerDetail.jsx), so every real save
      // from there sends both together -- the old check meant this never
      // fired at all for an existing partner. This always wins over
      // whatever this same save's own sendingChurch payload contained --
      // checking the box means Church Settings' current values win, full
      // stop, not a merge.
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

// POST /api/partners/sync-sending-church (admin only) — the explicit bulk
// counterpart to the automatic per-partner sync above: re-pulls Church
// Settings' current info into every Sending Church field, for every
// partner marked "Sent by our church." Surfaced on the About Church page
// as one bulk action rather than a per-partner button -- the goal is
// keeping every sent-by-us partner in sync together, not maintaining
// individual partner-by-partner sync state, so there's no single-partner
// version of this. Admin-only (not editor, unlike the routes above) since
// it rewrites every such partner in one action, the same blast radius as
// other site-wide settings actions. Deliberately not wrapped in one
// $transaction covering every partner -- each partner's sync is
// independently atomic already, this is idempotent and re-runnable, and a
// church with many partners could otherwise exceed Prisma's default
// transaction timeout.
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
    // Cascades to partner files/photos/addresses/etc. — their file bytes
    // live in the same row (see the PartnerFile model comment in
    // schema.prisma), so there's no separate external cleanup needed.
    await prisma.partner.delete({ where: { id: req.params.id } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

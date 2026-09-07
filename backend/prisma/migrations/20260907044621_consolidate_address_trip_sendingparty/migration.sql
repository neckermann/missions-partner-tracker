-- DataMigration: this schema change merges three pairs of previously-
-- duplicated models (Address/OrganizationAddress, MissionTrip+
-- TripParticipant/OrganizationTrip+OrganizationTripParticipant,
-- SendingChurch/SendingOrg) into shared tables, following the same
-- nullable dual-FK pattern already used by Newsletter/Document/
-- SupportEntry/ChurchVisit. Every statement below is hand-written, not
-- Prisma's auto-generated diff -- that diff would DROP every one of the
-- six tables being merged/renamed here (258 real rows across
-- MissionTrip/OrganizationAddress/OrganizationTrip/
-- OrganizationTripParticipant/SendingChurch/SendingOrg in the database
-- this was written against), since Prisma's differ has no way to know a
-- rename/merge was intended rather than a drop-and-recreate. Every row is
-- preserved below via RENAME (for the 1:1 renames) or INSERT ... SELECT
-- (for the tables being folded into an existing one), reusing each row's
-- original id so no foreign key needs remapping.

-- =====================================================================
-- Address: merge OrganizationAddress in
-- =====================================================================
ALTER TABLE "Address" ALTER COLUMN "missionaryId" DROP NOT NULL;
ALTER TABLE "Address" ADD COLUMN "organizationId" TEXT;

INSERT INTO "Address" (id, "organizationId", type, "addressLine1", "addressLine2", city, "stateProvinceRegion", "postalCode", country, "gpsLat", "gpsLng", "receiveMail", "receivePackages")
SELECT id, "organizationId", type, "addressLine1", "addressLine2", city, "stateProvinceRegion", "postalCode", country, "gpsLat", "gpsLng", "receiveMail", "receivePackages"
FROM "OrganizationAddress";

ALTER TABLE "Address" ADD CONSTRAINT "Address_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Address_organizationId_type_key" ON "Address"("organizationId", "type");

ALTER TABLE "OrganizationAddress" DROP CONSTRAINT "OrganizationAddress_organizationId_fkey";
DROP TABLE "OrganizationAddress";

-- =====================================================================
-- Trip: rename MissionTrip -> Trip, merge OrganizationTrip +
-- OrganizationTripParticipant in. Renaming (not dropping) MissionTrip
-- preserves TripParticipant's existing FK automatically -- Postgres
-- tracks foreign keys by the referenced table's OID, not its name, so
-- TripParticipant_tripId_fkey keeps working across the rename with no
-- changes needed on TripParticipant at all.
-- =====================================================================
ALTER TABLE "MissionTrip" RENAME TO "Trip";
ALTER TABLE "Trip" RENAME CONSTRAINT "MissionTrip_pkey" TO "Trip_pkey";
ALTER TABLE "Trip" RENAME CONSTRAINT "MissionTrip_missionaryId_fkey" TO "Trip_missionaryId_fkey";
ALTER TABLE "Trip" ALTER COLUMN "missionaryId" DROP NOT NULL;
ALTER TABLE "Trip" ADD COLUMN "organizationId" TEXT;

INSERT INTO "Trip" (id, "organizationId", "startDate", "endDate", "tripType", description, notes)
SELECT id, "organizationId", "startDate", "endDate", "tripType", description, notes
FROM "OrganizationTrip";

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OrganizationTrip rows above kept their original id, so their (already-
-- migrated) participants can be copied straight across referencing the
-- same tripId -- no remapping needed.
INSERT INTO "TripParticipant" (id, "tripId", name, role, "isLeader", phone, email)
SELECT id, "tripId", name, role, "isLeader", phone, email
FROM "OrganizationTripParticipant";

ALTER TABLE "OrganizationTripParticipant" DROP CONSTRAINT "OrganizationTripParticipant_tripId_fkey";
DROP TABLE "OrganizationTripParticipant";
ALTER TABLE "OrganizationTrip" DROP CONSTRAINT "OrganizationTrip_organizationId_fkey";
DROP TABLE "OrganizationTrip";

-- =====================================================================
-- SendingParty: rename SendingChurch -> SendingParty (as the "church"
-- rows), convert its old `mailingAddress` JSONB blob into real structured
-- columns matching Address's shape, then merge SendingOrg in as the
-- "org" rows (same JSON-to-columns conversion). The old @unique on
-- missionaryId alone (one row per missionary) becomes a composite
-- @@unique on (missionaryId, type) (one row per missionary PER type),
-- since a missionary can now have both a church row and an org row.
-- =====================================================================
ALTER TABLE "SendingChurch" RENAME TO "SendingParty";
ALTER TABLE "SendingParty" RENAME CONSTRAINT "SendingChurch_pkey" TO "SendingParty_pkey";
ALTER TABLE "SendingParty" RENAME CONSTRAINT "SendingChurch_missionaryId_fkey" TO "SendingParty_missionaryId_fkey";
DROP INDEX "SendingChurch_missionaryId_key";

ALTER TABLE "SendingParty" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'church';
ALTER TABLE "SendingParty" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "SendingParty" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "SendingParty" ADD COLUMN "city" TEXT;
ALTER TABLE "SendingParty" ADD COLUMN "stateProvinceRegion" TEXT;
ALTER TABLE "SendingParty" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "SendingParty" ADD COLUMN "country" TEXT;

UPDATE "SendingParty" SET
  "addressLine1" = "mailingAddress"->>'addressLine1',
  "addressLine2" = "mailingAddress"->>'addressLine2',
  "city" = "mailingAddress"->>'city',
  "stateProvinceRegion" = "mailingAddress"->>'stateProvinceRegion',
  "postalCode" = "mailingAddress"->>'postalCode',
  "country" = "mailingAddress"->>'country'
WHERE "mailingAddress" IS NOT NULL;

ALTER TABLE "SendingParty" DROP COLUMN "mailingAddress";
ALTER TABLE "SendingParty" ALTER COLUMN "type" DROP DEFAULT;

INSERT INTO "SendingParty" (id, "missionaryId", type, name, "contactName", "contactEmail", "websiteLink", phone, "addressLine1", "addressLine2", city, "stateProvinceRegion", "postalCode", country)
SELECT id, "missionaryId", 'org', name, "contactName", "contactEmail", "websiteLink", phone,
  "mailingAddress"->>'addressLine1', "mailingAddress"->>'addressLine2', "mailingAddress"->>'city',
  "mailingAddress"->>'stateProvinceRegion', "mailingAddress"->>'postalCode', "mailingAddress"->>'country'
FROM "SendingOrg";

CREATE UNIQUE INDEX "SendingParty_missionaryId_type_key" ON "SendingParty"("missionaryId", "type");

ALTER TABLE "SendingOrg" DROP CONSTRAINT "SendingOrg_missionaryId_fkey";
DROP TABLE "SendingOrg";

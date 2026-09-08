
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Missionary" (
    "id" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "contactSafe" BOOLEAN NOT NULL DEFAULT true,
    "preferredContactMethod" TEXT,
    "sentByOurChurch" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "fieldDisplayName" TEXT,
    "fipsCountryCode" TEXT,
    "overview" TEXT,
    "overviewShort" TEXT,
    "focusArea" TEXT,
    "supportingSince" DATE,
    "anniversary" DATE,
    "languagesSpoken" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tripTeamSizeMin" INTEGER,
    "tripTeamSizeMax" INTEGER,
    "tripTypesSupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tripSeasonNotes" TEXT,
    "tripLogisticsNotes" TEXT,
    "websiteLink" TEXT,
    "supportLink" TEXT,
    "newsletterSignup" TEXT,
    "facebook" TEXT,
    "twitter" TEXT,
    "instagram" TEXT,
    "linkedin" TEXT,
    "emergencyContact" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Missionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adult" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone1" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "birthday" DATE,

    CONSTRAINT "Adult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthday" DATE,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvinceRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "receiveMail" BOOLEAN,
    "receivePackages" BOOLEAN,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "tripType" TEXT,
    "description" TEXT,
    "notes" TEXT,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripParticipant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "TripParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Furlough" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,

    CONSTRAINT "Furlough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchVisit" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "visitDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChurchVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingParty" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "websiteLink" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvinceRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,

    CONSTRAINT "SendingParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "orgType" TEXT NOT NULL,
    "fieldDisplayName" TEXT,
    "fipsCountryCode" TEXT,
    "overview" TEXT,
    "overviewShort" TEXT,
    "focusArea" TEXT,
    "supportingSince" DATE,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "preferredContactMethod" TEXT,
    "tripTeamSizeMin" INTEGER,
    "tripTeamSizeMax" INTEGER,
    "tripTypesSupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tripSeasonNotes" TEXT,
    "tripLogisticsNotes" TEXT,
    "websiteLink" TEXT,
    "supportLink" TEXT,
    "newsletterSignup" TEXT,
    "facebook" TEXT,
    "twitter" TEXT,
    "instagram" TEXT,
    "linkedin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportEntry" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "amount" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNeed" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "description" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL,
    "requestDate" DATE NOT NULL,
    "approvedAmount" INTEGER,
    "approvedDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "category" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "dateReceived" DATE NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ongoing',
    "dateAnswered" DATE,
    "answeredNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PrayerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Newsletter" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "title" TEXT,
    "receivedDate" DATE NOT NULL,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Newsletter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "category" TEXT NOT NULL,
    "customCategory" TEXT,
    "title" TEXT,
    "receivedDate" DATE NOT NULL,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "bytes" BYTEA NOT NULL,
    "receivedDate" DATE NOT NULL,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "churchName" TEXT,
    "address" JSONB,
    "phone" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "websiteLink" TEXT,
    "partnerTermSingular" TEXT,
    "partnerTermPlural" TEXT,
    "usePartnerTermInAdmin" BOOLEAN NOT NULL DEFAULT false,
    "publicTagline" TEXT,
    "aboutText" TEXT,
    "primaryColor" TEXT,
    "logoBytes" BYTEA,
    "logoContentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ChurchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'local',
    "role" TEXT NOT NULL DEFAULT 'editor',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "ssoProviderId" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaSetupRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "allowedDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Missionary_isPublic_isRestricted_idx" ON "Missionary"("isPublic", "isRestricted");

-- CreateIndex
CREATE INDEX "Missionary_archived_idx" ON "Missionary"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "Address_missionaryId_type_key" ON "Address"("missionaryId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Address_organizationId_type_key" ON "Address"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Furlough_missionaryId_idx" ON "Furlough"("missionaryId");

-- CreateIndex
CREATE INDEX "ChurchVisit_missionaryId_idx" ON "ChurchVisit"("missionaryId");

-- CreateIndex
CREATE INDEX "ChurchVisit_organizationId_idx" ON "ChurchVisit"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingParty_missionaryId_type_key" ON "SendingParty"("missionaryId", "type");

-- CreateIndex
CREATE INDEX "Organization_isPublic_isRestricted_idx" ON "Organization"("isPublic", "isRestricted");

-- CreateIndex
CREATE INDEX "Organization_archived_idx" ON "Organization"("archived");

-- CreateIndex
CREATE INDEX "SupportEntry_missionaryId_idx" ON "SupportEntry"("missionaryId");

-- CreateIndex
CREATE INDEX "SupportEntry_organizationId_idx" ON "SupportEntry"("organizationId");

-- CreateIndex
CREATE INDEX "SupportNeed_missionaryId_idx" ON "SupportNeed"("missionaryId");

-- CreateIndex
CREATE INDEX "SupportNeed_organizationId_idx" ON "SupportNeed"("organizationId");

-- CreateIndex
CREATE INDEX "PrayerRequest_missionaryId_idx" ON "PrayerRequest"("missionaryId");

-- CreateIndex
CREATE INDEX "PrayerRequest_organizationId_idx" ON "PrayerRequest"("organizationId");

-- CreateIndex
CREATE INDEX "PrayerRequest_category_idx" ON "PrayerRequest"("category");

-- CreateIndex
CREATE INDEX "PrayerRequest_status_idx" ON "PrayerRequest"("status");

-- CreateIndex
CREATE INDEX "Newsletter_missionaryId_idx" ON "Newsletter"("missionaryId");

-- CreateIndex
CREATE INDEX "Newsletter_organizationId_idx" ON "Newsletter"("organizationId");

-- CreateIndex
CREATE INDEX "Document_missionaryId_idx" ON "Document"("missionaryId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_category_idx" ON "Document"("category");

-- CreateIndex
CREATE INDEX "Photo_missionaryId_idx" ON "Photo"("missionaryId");

-- CreateIndex
CREATE INDEX "Photo_organizationId_idx" ON "Photo"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Adult" ADD CONSTRAINT "Adult_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Furlough" ADD CONSTRAINT "Furlough_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingParty" ADD CONSTRAINT "SendingParty_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ssoProviderId_fkey" FOREIGN KEY ("ssoProviderId") REFERENCES "SsoProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;


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
    "images" JSONB,
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
    "missionaryId" TEXT NOT NULL,
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
CREATE TABLE "MissionTrip" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "tripType" TEXT,
    "description" TEXT,
    "notes" TEXT,

    CONSTRAINT "MissionTrip_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "SendingChurch" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "name" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "websiteLink" TEXT,
    "mailingAddress" JSONB,
    "phone" TEXT,

    CONSTRAINT "SendingChurch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingOrg" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT NOT NULL,
    "name" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "websiteLink" TEXT,
    "mailingAddress" JSONB,
    "phone" TEXT,

    CONSTRAINT "SendingOrg_pkey" PRIMARY KEY ("id")
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
    "images" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationAddress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
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

    CONSTRAINT "OrganizationAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationTrip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "tripType" TEXT,
    "description" TEXT,
    "notes" TEXT,

    CONSTRAINT "OrganizationTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationTripParticipant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "OrganizationTripParticipant_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Newsletter" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "title" TEXT,
    "receivedDate" DATE NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Newsletter_pkey" PRIMARY KEY ("id")
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
    "logo" JSONB,
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
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaSetupRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Missionary_isPublic_isRestricted_idx" ON "Missionary"("isPublic", "isRestricted");

-- CreateIndex
CREATE INDEX "Missionary_archived_idx" ON "Missionary"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "Address_missionaryId_type_key" ON "Address"("missionaryId", "type");

-- CreateIndex
CREATE INDEX "Furlough_missionaryId_idx" ON "Furlough"("missionaryId");

-- CreateIndex
CREATE INDEX "ChurchVisit_missionaryId_idx" ON "ChurchVisit"("missionaryId");

-- CreateIndex
CREATE INDEX "ChurchVisit_organizationId_idx" ON "ChurchVisit"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingChurch_missionaryId_key" ON "SendingChurch"("missionaryId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingOrg_missionaryId_key" ON "SendingOrg"("missionaryId");

-- CreateIndex
CREATE INDEX "Organization_isPublic_isRestricted_idx" ON "Organization"("isPublic", "isRestricted");

-- CreateIndex
CREATE INDEX "Organization_archived_idx" ON "Organization"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAddress_organizationId_type_key" ON "OrganizationAddress"("organizationId", "type");

-- CreateIndex
CREATE INDEX "SupportEntry_missionaryId_idx" ON "SupportEntry"("missionaryId");

-- CreateIndex
CREATE INDEX "SupportEntry_organizationId_idx" ON "SupportEntry"("organizationId");

-- CreateIndex
CREATE INDEX "SupportNeed_missionaryId_idx" ON "SupportNeed"("missionaryId");

-- CreateIndex
CREATE INDEX "SupportNeed_organizationId_idx" ON "SupportNeed"("organizationId");

-- CreateIndex
CREATE INDEX "Newsletter_missionaryId_idx" ON "Newsletter"("missionaryId");

-- CreateIndex
CREATE INDEX "Newsletter_organizationId_idx" ON "Newsletter"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Adult" ADD CONSTRAINT "Adult_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionTrip" ADD CONSTRAINT "MissionTrip_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "MissionTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Furlough" ADD CONSTRAINT "Furlough_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingChurch" ADD CONSTRAINT "SendingChurch_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingOrg" ADD CONSTRAINT "SendingOrg_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAddress" ADD CONSTRAINT "OrganizationAddress_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationTrip" ADD CONSTRAINT "OrganizationTrip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationTripParticipant" ADD CONSTRAINT "OrganizationTripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "OrganizationTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint
-- SupportEntry, SupportNeed, Newsletter, and ChurchVisit are shared tables
-- that can belong to either a Missionary or an Organization (never both,
-- never neither) — not enforceable through Prisma's schema language, so
-- these are plain DB check constraints.
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_one_parent_check"
    CHECK (
        ("missionaryId" IS NOT NULL AND "organizationId" IS NULL) OR
        ("missionaryId" IS NULL AND "organizationId" IS NOT NULL)
    );

ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_one_parent_check"
    CHECK (
        ("missionaryId" IS NOT NULL AND "organizationId" IS NULL) OR
        ("missionaryId" IS NULL AND "organizationId" IS NOT NULL)
    );

ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_one_parent_check"
    CHECK (
        ("missionaryId" IS NOT NULL AND "organizationId" IS NULL) OR
        ("missionaryId" IS NULL AND "organizationId" IS NOT NULL)
    );

ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_one_parent_check"
    CHECK (
        ("missionaryId" IS NOT NULL AND "organizationId" IS NULL) OR
        ("missionaryId" IS NULL AND "organizationId" IS NOT NULL)
    );


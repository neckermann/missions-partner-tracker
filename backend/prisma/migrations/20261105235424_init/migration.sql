-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "fieldDisplayName" TEXT,
    "fipsCountryCode" TEXT,
    "overview" TEXT,
    "overviewShort" TEXT,
    "focusArea" TEXT,
    "supportingSince" DATE,
    "preferredContactMethod" TEXT,
    "contactSafe" BOOLEAN NOT NULL DEFAULT true,
    "sentByOurChurch" BOOLEAN NOT NULL DEFAULT false,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "orgType" TEXT,
    "anniversary" DATE,
    "languagesSpoken" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergencyContact" JSONB,
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

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adult" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
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
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthday" DATE,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
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
    "partnerId" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "tripType" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "albumProvider" TEXT,
    "albumUrl" TEXT,

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
    "partnerId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,

    CONSTRAINT "Furlough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchVisit" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "visitDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChurchVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingParty" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
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
CREATE TABLE "SupportEntry" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNeed" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL,
    "requestDate" DATE NOT NULL,
    "approvedAmount" INTEGER,
    "approvedDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFileId" TEXT,

    CONSTRAINT "SupportNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "dateReceived" DATE NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "includeInBooklet" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ongoing',
    "dateAnswered" DATE,
    "answeredNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFileId" TEXT,

    CONSTRAINT "PrayerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerFile" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customKind" TEXT,
    "title" TEXT,
    "receivedDate" DATE NOT NULL,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingNotification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupmeSentAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedText" TEXT,
    "weeklyDigestSentAt" TIMESTAMP(3),
    "biweeklyDigestSentAt" TIMESTAMP(3),
    "monthlyDigestSentAt" TIMESTAMP(3),

    CONSTRAINT "PendingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "receivedDate" DATE NOT NULL,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "headerColor" TEXT,
    "highlightColor" TEXT,
    "brandFont" TEXT,
    "logoBytes" BYTEA,
    "logoContentType" TEXT,
    "groupmeAccessToken" TEXT,
    "groupmeGroupId" TEXT,
    "groupmeGroupName" TEXT,
    "groupmePrayerTopicId" TEXT,
    "groupmePrayerTopicName" TEXT,
    "groupmeOneTimeNeedTopicId" TEXT,
    "groupmeOneTimeNeedTopicName" TEXT,
    "groupmeNewsletterTopicId" TEXT,
    "groupmeNewsletterTopicName" TEXT,
    "joshuaProjectApiKey" TEXT,
    "anthropicApiKey" TEXT,
    "postmarkServerToken" TEXT,
    "emailFromAddress" TEXT,
    "inboundEmailWebhookUsername" TEXT,
    "inboundEmailWebhookPassword" TEXT,
    "enabledFeatures" JSONB NOT NULL DEFAULT '{}',
    "backupReminderDisabled" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT,
    "digestDayOfWeek" INTEGER,
    "digestDayOfMonth" INTEGER,
    "digestHour" INTEGER,
    "lastDigestSentAt" TIMESTAMP(3),
    "scopedDigestDayOfWeek" INTEGER,
    "scopedDigestDayOfMonth" INTEGER,
    "scopedDigestHour" INTEGER,
    "lastWeeklyScopedDigestSentAt" TIMESTAMP(3),
    "lastBiweeklyScopedDigestSentAt" TIMESTAMP(3),
    "lastMonthlyScopedDigestSentAt" TIMESTAMP(3),
    "queueNotifyPrayerRequests" BOOLEAN NOT NULL DEFAULT true,
    "queueNotifyOneTimeNeeds" BOOLEAN NOT NULL DEFAULT true,
    "queueNotifyNewsletters" BOOLEAN NOT NULL DEFAULT true,
    "queueNotifyRestrictedPartners" BOOLEAN NOT NULL DEFAULT true,
    "digestSubjectTemplate" TEXT,
    "digestSignature" TEXT,
    "digestTemplate" TEXT,
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
    "mfaLastTimeStep" INTEGER,
    "mfaSetupRequired" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT,
    "allPartners" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFollowedPartner" (
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "UserFollowedPartner_pkey" PRIMARY KEY ("userId","partnerId")
);

-- CreateTable
CREATE TABLE "PublicSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "allPartners" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PublicSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSubscriberPartner" (
    "subscriberId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "PublicSubscriberPartner_pkey" PRIMARY KEY ("subscriberId","partnerId")
);

-- CreateIndex
CREATE INDEX "Partner_kind_idx" ON "Partner"("kind");

-- CreateIndex
CREATE INDEX "Partner_isPublic_isRestricted_idx" ON "Partner"("isPublic", "isRestricted");

-- CreateIndex
CREATE INDEX "Partner_archived_idx" ON "Partner"("archived");

-- CreateIndex
CREATE INDEX "Adult_partnerId_idx" ON "Adult"("partnerId");

-- CreateIndex
CREATE INDEX "Child_partnerId_idx" ON "Child"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Address_partnerId_type_key" ON "Address"("partnerId", "type");

-- CreateIndex
CREATE INDEX "Trip_partnerId_idx" ON "Trip"("partnerId");

-- CreateIndex
CREATE INDEX "TripParticipant_tripId_idx" ON "TripParticipant"("tripId");

-- CreateIndex
CREATE INDEX "Furlough_partnerId_idx" ON "Furlough"("partnerId");

-- CreateIndex
CREATE INDEX "ChurchVisit_partnerId_idx" ON "ChurchVisit"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingParty_partnerId_type_key" ON "SendingParty"("partnerId", "type");

-- CreateIndex
CREATE INDEX "SupportEntry_partnerId_idx" ON "SupportEntry"("partnerId");

-- CreateIndex
CREATE INDEX "SupportNeed_partnerId_idx" ON "SupportNeed"("partnerId");

-- CreateIndex
CREATE INDEX "PrayerRequest_partnerId_idx" ON "PrayerRequest"("partnerId");

-- CreateIndex
CREATE INDEX "PrayerRequest_category_idx" ON "PrayerRequest"("category");

-- CreateIndex
CREATE INDEX "PrayerRequest_status_idx" ON "PrayerRequest"("status");

-- CreateIndex
CREATE INDEX "PartnerFile_partnerId_idx" ON "PartnerFile"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerFile_kind_idx" ON "PartnerFile"("kind");

-- CreateIndex
CREATE INDEX "PendingNotification_type_idx" ON "PendingNotification"("type");

-- CreateIndex
CREATE INDEX "PendingNotification_partnerId_idx" ON "PendingNotification"("partnerId");

-- CreateIndex
CREATE INDEX "Photo_partnerId_idx" ON "Photo"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserFollowedPartner_partnerId_idx" ON "UserFollowedPartner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSubscriber_email_key" ON "PublicSubscriber"("email");

-- CreateIndex
CREATE INDEX "PublicSubscriber_confirmedAt_idx" ON "PublicSubscriber"("confirmedAt");

-- CreateIndex
CREATE INDEX "PublicSubscriberPartner_partnerId_idx" ON "PublicSubscriberPartner"("partnerId");

-- AddForeignKey
ALTER TABLE "Adult" ADD CONSTRAINT "Adult_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Furlough" ADD CONSTRAINT "Furlough_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingParty" ADD CONSTRAINT "SendingParty_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "PartnerFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "PartnerFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerFile" ADD CONSTRAINT "PartnerFile_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingNotification" ADD CONSTRAINT "PendingNotification_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "PublicSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

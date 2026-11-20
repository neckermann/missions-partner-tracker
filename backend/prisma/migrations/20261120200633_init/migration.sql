-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "orgType" TEXT,
    "anniversary" DATE,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactEmail" TEXT,
    "tripTeamSizeMin" INTEGER,
    "tripTeamSizeMax" INTEGER,
    "tripTypesSupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tripSeasonNotes" TEXT,
    "tripLogisticsNotes" TEXT,
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
    "firstName" TEXT,
    "lastName" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "birthday" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthday" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "partnerId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "startDate" DATE,
    "endDate" DATE,
    "type" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "teamSizeMin" INTEGER,
    "teamSizeMax" INTEGER,
    "supportRaisingGoal" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "collectParentGuardianInfo" BOOLEAN NOT NULL DEFAULT false,
    "applicationShareToken" TEXT,
    "applicationQuestions" JSONB,
    "albumProvider" TEXT,
    "albumUrl" TEXT,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripParticipant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "email" TEXT,
    "applicationId" TEXT,
    "supportRaisingGoal" INTEGER,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvinceRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "emergencyContactFirstName" TEXT,
    "emergencyContactLastName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactEmail" TEXT,
    "dateOfBirth" DATE,
    "parentGuardianFirstName" TEXT,
    "parentGuardianLastName" TEXT,
    "parentGuardianRelationship" TEXT,
    "parentGuardianPhone" TEXT,
    "parentGuardianEmail" TEXT,
    "shareToken" TEXT,
    "story" TEXT,
    "photoContentType" TEXT,
    "accessTokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripParticipantPhoto" (
    "id" TEXT NOT NULL,
    "photo" BYTEA NOT NULL,

    CONSTRAINT "TripParticipantPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripApplication" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responses" JSONB,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvinceRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "emergencyContactFirstName" TEXT,
    "emergencyContactLastName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactEmail" TEXT,
    "dateOfBirth" DATE,
    "parentGuardianFirstName" TEXT,
    "parentGuardianLastName" TEXT,
    "parentGuardianRelationship" TEXT,
    "parentGuardianPhone" TEXT,
    "parentGuardianEmail" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "declinedReason" TEXT,

    CONSTRAINT "TripApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMeeting" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "location" TEXT,
    "meetingLink" TEXT,
    "agenda" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "TripMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMeetingRsvp" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripMeetingRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRequirement" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'document',
    "bodyText" TEXT,
    "dueAt" DATE,
    "reminderLeadDays" INTEGER,
    "minorsOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TripRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRequirementStatus" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),

    CONSTRAINT "TripRequirementStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDocument" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "participantId" TEXT,
    "requirementId" TEXT,
    "title" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signerName" TEXT,
    "signerRelationship" TEXT,
    "attestedAt" TIMESTAMP(3),
    "ip" TEXT,
    "documentTextSnapshot" TEXT,
    "documentTextHash" TEXT,

    CONSTRAINT "TripDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDocumentBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "signatureImage" BYTEA,

    CONSTRAINT "TripDocumentBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripContribution" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "participantId" TEXT,
    "donorName" TEXT NOT NULL,
    "donorEmail" TEXT,
    "donorPhone" TEXT,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receivedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripBudgetLine" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "estimatedAmount" INTEGER NOT NULL,

    CONSTRAINT "TripBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripFlightSegment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "airline" TEXT,
    "flightNumber" TEXT,
    "departureAirport" TEXT,
    "departureAt" TIMESTAMP(3),
    "arrivalAirport" TEXT,
    "arrivalAt" TIMESTAMP(3),

    CONSTRAINT "TripFlightSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Furlough" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
CREATE TABLE "PartnerLink" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerLanguage" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "proficiency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingParty" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
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
    "decisionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
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
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
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
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerFileBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "PartnerFileBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmailBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "InboundEmailBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRecord" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupmeDispatchedAt" TIMESTAMP(3),
    "whatsappDispatchedAt" TIMESTAMP(3),
    "dispatchReviewedAt" TIMESTAMP(3),
    "dispatchReviewedById" TEXT,
    "dispatchReviewedText" TEXT,
    "biweeklyEmailDispatchSentAt" TIMESTAMP(3),
    "monthlyEmailDispatchSentAt" TIMESTAMP(3),
    "quarterlyEmailDispatchSentAt" TIMESTAMP(3),

    CONSTRAINT "DispatchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "PhotoBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "churchName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvinceRegion" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
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
    "whatsappPhoneNumber" TEXT,
    "whatsappPairedAt" TIMESTAMP(3),
    "whatsappCommunityId" TEXT,
    "whatsappCommunityName" TEXT,
    "whatsappAnnouncementGroupId" TEXT,
    "whatsappAnnouncementGroupName" TEXT,
    "whatsappPrayerGroupId" TEXT,
    "whatsappPrayerGroupName" TEXT,
    "whatsappOneTimeNeedGroupId" TEXT,
    "whatsappOneTimeNeedGroupName" TEXT,
    "whatsappNewsletterGroupId" TEXT,
    "whatsappNewsletterGroupName" TEXT,
    "joshuaProjectApiKey" TEXT,
    "anthropicApiKey" TEXT,
    "postmarkServerToken" TEXT,
    "emailFromAddress" TEXT,
    "inboundEmailWebhookUsername" TEXT,
    "inboundEmailWebhookPassword" TEXT,
    "enabledFeatures" JSONB NOT NULL DEFAULT '{}',
    "backupReminderDisabled" BOOLEAN NOT NULL DEFAULT false,
    "emailDispatchDayOfWeek" INTEGER,
    "emailDispatchDayOfMonth" INTEGER,
    "emailDispatchHour" INTEGER,
    "lastBiweeklyEmailDispatchSentAt" TIMESTAMP(3),
    "lastMonthlyEmailDispatchSentAt" TIMESTAMP(3),
    "lastQuarterlyEmailDispatchSentAt" TIMESTAMP(3),
    "chatDispatchHour" INTEGER,
    "lastGroupmeChatDispatchSentAt" TIMESTAMP(3),
    "lastWhatsappChatDispatchSentAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "chatDispatchPrayerRequests" BOOLEAN NOT NULL DEFAULT true,
    "chatDispatchOneTimeNeeds" BOOLEAN NOT NULL DEFAULT true,
    "chatDispatchNewsletters" BOOLEAN NOT NULL DEFAULT true,
    "allowRestrictedPartnerDispatch" BOOLEAN NOT NULL DEFAULT false,
    "emailDispatchSubjectTemplate" TEXT,
    "emailDispatchSignature" TEXT,
    "emailDispatchLayout" TEXT,
    "onlineGivingUrl" TEXT,
    "onlineGivingInstructions" TEXT,
    "collectDonorContactInfo" BOOLEAN NOT NULL DEFAULT false,
    "collectApplicantAddress" BOOLEAN NOT NULL DEFAULT true,
    "collectEmergencyContact" BOOLEAN NOT NULL DEFAULT true,
    "allowPrivateApplicationLinks" BOOLEAN NOT NULL DEFAULT false,
    "allowPublicSupportRaisingLinks" BOOLEAN NOT NULL DEFAULT false,
    "enableTripBudgeting" BOOLEAN NOT NULL DEFAULT false,
    "inboundEmailAddress" TEXT,
    "collectDateOfBirth" BOOLEAN NOT NULL DEFAULT true,
    "requireDateOfBirth" BOOLEAN NOT NULL DEFAULT false,
    "tripApplicationTemplate" JSONB,
    "tripQuestionLibrary" JSONB,
    "tripRequirementTemplate" JSONB,
    "tripRequirementLibrary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ChurchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchSettingsLogo" (
    "id" TEXT NOT NULL,
    "logoBytes" BYTEA NOT NULL,

    CONSTRAINT "ChurchSettingsLogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
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
    "cadence" TEXT,
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
    "cadence" TEXT NOT NULL DEFAULT 'biweekly',
    "allPartners" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PublicSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSubscriberPartner" (
    "subscriberId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "PublicSubscriberPartner_pkey" PRIMARY KEY ("subscriberId","partnerId")
);

-- CreateTable
CREATE TABLE "WhatsAppAuthEntry" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthEntry_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_TripFlightSegmentToTripParticipant" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TripFlightSegmentToTripParticipant_AB_pkey" PRIMARY KEY ("A","B")
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
CREATE UNIQUE INDEX "Trip_applicationShareToken_key" ON "Trip"("applicationShareToken");

-- CreateIndex
CREATE INDEX "Trip_partnerId_idx" ON "Trip"("partnerId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TripParticipant_applicationId_key" ON "TripParticipant"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "TripParticipant_shareToken_key" ON "TripParticipant"("shareToken");

-- CreateIndex
CREATE INDEX "TripParticipant_tripId_idx" ON "TripParticipant"("tripId");

-- CreateIndex
CREATE INDEX "TripApplication_tripId_idx" ON "TripApplication"("tripId");

-- CreateIndex
CREATE INDEX "TripMeeting_tripId_idx" ON "TripMeeting"("tripId");

-- CreateIndex
CREATE INDEX "TripMeetingRsvp_participantId_idx" ON "TripMeetingRsvp"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TripMeetingRsvp_meetingId_participantId_key" ON "TripMeetingRsvp"("meetingId", "participantId");

-- CreateIndex
CREATE INDEX "TripRequirement_tripId_idx" ON "TripRequirement"("tripId");

-- CreateIndex
CREATE INDEX "TripRequirementStatus_participantId_idx" ON "TripRequirementStatus"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TripRequirementStatus_requirementId_participantId_key" ON "TripRequirementStatus"("requirementId", "participantId");

-- CreateIndex
CREATE INDEX "TripDocument_tripId_idx" ON "TripDocument"("tripId");

-- CreateIndex
CREATE INDEX "TripDocument_participantId_idx" ON "TripDocument"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TripDocument_requirementId_participantId_key" ON "TripDocument"("requirementId", "participantId");

-- CreateIndex
CREATE INDEX "TripContribution_tripId_idx" ON "TripContribution"("tripId");

-- CreateIndex
CREATE INDEX "TripContribution_participantId_idx" ON "TripContribution"("participantId");

-- CreateIndex
CREATE INDEX "TripBudgetLine_tripId_idx" ON "TripBudgetLine"("tripId");

-- CreateIndex
CREATE INDEX "TripFlightSegment_tripId_idx" ON "TripFlightSegment"("tripId");

-- CreateIndex
CREATE INDEX "Furlough_partnerId_idx" ON "Furlough"("partnerId");

-- CreateIndex
CREATE INDEX "ChurchVisit_partnerId_idx" ON "ChurchVisit"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerLink_partnerId_type_key" ON "PartnerLink"("partnerId", "type");

-- CreateIndex
CREATE INDEX "PartnerLanguage_partnerId_idx" ON "PartnerLanguage"("partnerId");

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
CREATE INDEX "DispatchRecord_type_idx" ON "DispatchRecord"("type");

-- CreateIndex
CREATE INDEX "DispatchRecord_partnerId_idx" ON "DispatchRecord"("partnerId");

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

-- CreateIndex
CREATE INDEX "_TripFlightSegmentToTripParticipant_B_index" ON "_TripFlightSegmentToTripParticipant"("B");

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
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TripApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripParticipantPhoto" ADD CONSTRAINT "TripParticipantPhoto_id_fkey" FOREIGN KEY ("id") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripApplication" ADD CONSTRAINT "TripApplication_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMeeting" ADD CONSTRAINT "TripMeeting_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMeetingRsvp" ADD CONSTRAINT "TripMeetingRsvp_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "TripMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMeetingRsvp" ADD CONSTRAINT "TripMeetingRsvp_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequirement" ADD CONSTRAINT "TripRequirement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequirementStatus" ADD CONSTRAINT "TripRequirementStatus_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TripRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequirementStatus" ADD CONSTRAINT "TripRequirementStatus_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TripRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocumentBytes" ADD CONSTRAINT "TripDocumentBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "TripDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripContribution" ADD CONSTRAINT "TripContribution_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripContribution" ADD CONSTRAINT "TripContribution_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripBudgetLine" ADD CONSTRAINT "TripBudgetLine_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripFlightSegment" ADD CONSTRAINT "TripFlightSegment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Furlough" ADD CONSTRAINT "Furlough_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchVisit" ADD CONSTRAINT "ChurchVisit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLink" ADD CONSTRAINT "PartnerLink_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLanguage" ADD CONSTRAINT "PartnerLanguage_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "PartnerFileBytes" ADD CONSTRAINT "PartnerFileBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "PartnerFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmailBytes" ADD CONSTRAINT "InboundEmailBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "InboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoBytes" ADD CONSTRAINT "PhotoBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchSettingsLogo" ADD CONSTRAINT "ChurchSettingsLogo_id_fkey" FOREIGN KEY ("id") REFERENCES "ChurchSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "PublicSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TripFlightSegmentToTripParticipant" ADD CONSTRAINT "_TripFlightSegmentToTripParticipant_A_fkey" FOREIGN KEY ("A") REFERENCES "TripFlightSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TripFlightSegmentToTripParticipant" ADD CONSTRAINT "_TripFlightSegmentToTripParticipant_B_fkey" FOREIGN KEY ("B") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


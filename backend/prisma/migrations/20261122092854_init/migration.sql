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
    "lastPrayedWithCongregationAt" DATE,
    "preferredContactMethod" TEXT,
    "contactSafe" BOOLEAN NOT NULL DEFAULT true,
    "contactInstructions" TEXT,
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
    "tripSeasonNotes" TEXT,
    "tripLogisticsNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "Adult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "birthday" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "applicationShareToken" TEXT,
    "applicationQuestions" JSONB,
    "albumProvider" TEXT,
    "albumUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripParticipant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT,
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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "declinedReason" TEXT,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "TripApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMeeting" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "location" TEXT,
    "meetingLink" TEXT,
    "agenda" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'document',
    "bodyText" TEXT,
    "dueAt" DATE,
    "reminderLeadDays" INTEGER,
    "minorsOnly" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "TripRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRequirementStatus" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "TripContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripBudgetLine" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "estimatedAmount" INTEGER NOT NULL,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "Furlough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchVisit" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "visitDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "ChurchVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactLog" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "topics" TEXT[],
    "contactedById" TEXT,
    "createdById" TEXT,
    "contactDate" DATE NOT NULL,
    "notes" TEXT,
    "followUpDate" DATE,
    "prayerRequestId" TEXT,
    "supportNeedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "targetUserId" TEXT,
    "targetEmail" TEXT,
    "targetName" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "ip" TEXT,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyDateReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "occurrenceDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyDateReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerLink" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerLanguage" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "proficiency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripType" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "TripType_pkey" PRIMARY KEY ("id")
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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "SupportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "savedReportId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "recipientIds" TEXT[],
    "skipIfEmpty" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "queueReason" TEXT,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmailBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "InboundEmailBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmailFailure" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "rawPayloadSnippet" TEXT,

    CONSTRAINT "InboundEmailFailure_pkey" PRIMARY KEY ("id")
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
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "biweeklyEmailDispatchSentAt" TIMESTAMP(3),
    "monthlyEmailDispatchSentAt" TIMESTAMP(3),
    "quarterlyEmailDispatchSentAt" TIMESTAMP(3),
    "groupmeError" TEXT,
    "whatsappError" TEXT,
    "emailError" TEXT,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "whatsappLastError" TEXT,
    "whatsappDisconnectedAt" TIMESTAMP(3),
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
    "extractionModel" TEXT,
    "postmarkServerToken" TEXT,
    "emailFromAddress" TEXT,
    "inboundEmailWebhookUsername" TEXT,
    "inboundEmailWebhookPassword" TEXT,
    "enabledFeatures" JSONB NOT NULL DEFAULT '{}',
    "backupReminderDisabled" BOOLEAN NOT NULL DEFAULT false,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false,
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
    "restrictedPartnerInitialsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCareLeadUserId" TEXT,
    "emailDispatchSubjectTemplate" TEXT,
    "emailDispatchSignature" TEXT,
    "emailDispatchLayout" TEXT,
    "cadenceBiweeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cadenceMonthlyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cadenceQuarterlyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onlineGivingUrl" TEXT,
    "onlineGivingInstructions" TEXT,
    "collectDonorContactInfo" BOOLEAN NOT NULL DEFAULT false,
    "collectApplicantAddress" BOOLEAN NOT NULL DEFAULT true,
    "collectEmergencyContact" BOOLEAN NOT NULL DEFAULT true,
    "allowPrivateApplicationLinks" BOOLEAN NOT NULL DEFAULT false,
    "allowPublicSupportRaisingLinks" BOOLEAN NOT NULL DEFAULT false,
    "enableTripBudgeting" BOOLEAN NOT NULL DEFAULT false,
    "inboundEmailAddress" TEXT,
    "tripApplicationTemplate" JSONB,
    "tripQuestionLibrary" JSONB,
    "tripRequirementTemplate" JSONB,
    "tripRequirementLibrary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

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
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaLastTimeStep" INTEGER,
    "mfaSetupRequired" BOOLEAN NOT NULL DEFAULT false,
    "cadence" TEXT,
    "allPartners" BOOLEAN NOT NULL DEFAULT true,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordSetupToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordSetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSeen" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSeen_pkey" PRIMARY KEY ("userId","category")
);

-- CreateTable
CREATE TABLE "UserFollowedPartner" (
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "UserFollowedPartner_pkey" PRIMARY KEY ("userId","partnerId")
);

-- CreateTable
CREATE TABLE "CareTeamMember" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "CareTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportOption" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'offer',
    "choices" TEXT[],
    "allowOther" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "SupportOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSupportPreference" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "choice" TEXT,
    "choices" TEXT[],
    "other" TEXT,
    "text" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerSupportPreference_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "ContactLog_partnerId_contactDate_idx" ON "ContactLog"("partnerId", "contactDate");

-- CreateIndex
CREATE INDEX "ContactLog_contactedById_idx" ON "ContactLog"("contactedById");

-- CreateIndex
CREATE INDEX "ContactLog_followUpDate_idx" ON "ContactLog"("followUpDate");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_createdAt_idx" ON "AuditLog"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "KeyDateReminder_partnerId_idx" ON "KeyDateReminder"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "KeyDateReminder_userId_partnerId_kind_subjectId_occurrenceD_key" ON "KeyDateReminder"("userId", "partnerId", "kind", "subjectId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerLink_partnerId_type_key" ON "PartnerLink"("partnerId", "type");

-- CreateIndex
CREATE INDEX "PartnerLanguage_partnerId_idx" ON "PartnerLanguage"("partnerId");

-- CreateIndex
CREATE INDEX "TripType_partnerId_idx" ON "TripType"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingParty_partnerId_type_key" ON "SendingParty"("partnerId", "type");

-- CreateIndex
CREATE INDEX "SupportEntry_partnerId_idx" ON "SupportEntry"("partnerId");

-- CreateIndex
CREATE INDEX "SavedReport_ownerId_idx" ON "SavedReport"("ownerId");

-- CreateIndex
CREATE INDEX "SavedReport_reportId_idx" ON "SavedReport"("reportId");

-- CreateIndex
CREATE INDEX "ReportSchedule_savedReportId_idx" ON "ReportSchedule"("savedReportId");

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
CREATE UNIQUE INDEX "PasswordSetupToken_tokenHash_key" ON "PasswordSetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordSetupToken_userId_idx" ON "PasswordSetupToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordSetupToken_expiresAt_idx" ON "PasswordSetupToken"("expiresAt");

-- CreateIndex
CREATE INDEX "TripAccess_tripId_idx" ON "TripAccess"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripAccess_userId_tripId_key" ON "TripAccess"("userId", "tripId");

-- CreateIndex
CREATE INDEX "UserFollowedPartner_partnerId_idx" ON "UserFollowedPartner"("partnerId");

-- CreateIndex
CREATE INDEX "CareTeamMember_userId_idx" ON "CareTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CareTeamMember_partnerId_userId_key" ON "CareTeamMember"("partnerId", "userId");

-- CreateIndex
CREATE INDEX "SupportOption_group_sortOrder_idx" ON "SupportOption"("group", "sortOrder");

-- CreateIndex
CREATE INDEX "PartnerSupportPreference_optionId_idx" ON "PartnerSupportPreference"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSupportPreference_partnerId_optionId_key" ON "PartnerSupportPreference"("partnerId", "optionId");

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
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_contactedById_fkey" FOREIGN KEY ("contactedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDateReminder" ADD CONSTRAINT "KeyDateReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDateReminder" ADD CONSTRAINT "KeyDateReminder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLink" ADD CONSTRAINT "PartnerLink_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLanguage" ADD CONSTRAINT "PartnerLanguage_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripType" ADD CONSTRAINT "TripType_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingParty" ADD CONSTRAINT "SendingParty_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEntry" ADD CONSTRAINT "SupportEntry_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_savedReportId_fkey" FOREIGN KEY ("savedReportId") REFERENCES "SavedReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "ChurchSettings" ADD CONSTRAINT "ChurchSettings_defaultCareLeadUserId_fkey" FOREIGN KEY ("defaultCareLeadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchSettingsLogo" ADD CONSTRAINT "ChurchSettingsLogo_id_fkey" FOREIGN KEY ("id") REFERENCES "ChurchSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordSetupToken" ADD CONSTRAINT "PasswordSetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripAccess" ADD CONSTRAINT "TripAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripAccess" ADD CONSTRAINT "TripAccess_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSeen" ADD CONSTRAINT "NotificationSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSupportPreference" ADD CONSTRAINT "PartnerSupportPreference_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSupportPreference" ADD CONSTRAINT "PartnerSupportPreference_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SupportOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "PublicSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TripFlightSegmentToTripParticipant" ADD CONSTRAINT "_TripFlightSegmentToTripParticipant_A_fkey" FOREIGN KEY ("A") REFERENCES "TripFlightSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TripFlightSegmentToTripParticipant" ADD CONSTRAINT "_TripFlightSegmentToTripParticipant_B_fkey" FOREIGN KEY ("B") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one lead per partner. Prisma's schema language can't express a
-- partial unique index, so it is added by hand here (the route enforces the
-- same rule; this makes the database refuse a second lead too).
CREATE UNIQUE INDEX "CareTeamMember_one_lead_per_partner" ON "CareTeamMember"("partnerId") WHERE "isLead";

-- At most one primary contact per partner (same reason as above).
CREATE UNIQUE INDEX "Adult_one_primary_contact_per_partner" ON "Adult"("partnerId") WHERE "isPrimaryContact";

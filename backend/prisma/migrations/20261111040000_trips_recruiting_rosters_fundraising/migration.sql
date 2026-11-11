-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "allowPrivateApplicationLinks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowPublicFundraisingLinks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collectDonorContactInfo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inboundEmailAddress" TEXT,
ADD COLUMN     "onlineGivingInstructions" TEXT,
ADD COLUMN     "onlineGivingUrl" TEXT;

-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "tripType",
ADD COLUMN     "applicationQuestions" JSONB,
ADD COLUMN     "applicationShareToken" TEXT,
ADD COLUMN     "flightDetails" TEXT,
ADD COLUMN     "fundraisingGoal" INTEGER,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'completed',
ADD COLUMN     "teamSizeMax" INTEGER,
ADD COLUMN     "teamSizeMin" INTEGER,
ADD COLUMN     "type" TEXT,
ALTER COLUMN "partnerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TripParticipant" DROP COLUMN "name",
ADD COLUMN     "accessTokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "fundraisingGoal" INTEGER,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "story" TEXT;

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
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "TripApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMeeting" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),

    CONSTRAINT "TripMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDocumentRequirement" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "TripDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDocument" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "participantId" TEXT,
    "requirementId" TEXT,
    "title" TEXT,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripDocument_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "TripApplication_tripId_idx" ON "TripApplication"("tripId");

-- CreateIndex
CREATE INDEX "TripMeeting_tripId_idx" ON "TripMeeting"("tripId");

-- CreateIndex
CREATE INDEX "TripDocumentRequirement_tripId_idx" ON "TripDocumentRequirement"("tripId");

-- CreateIndex
CREATE INDEX "TripDocument_tripId_idx" ON "TripDocument"("tripId");

-- CreateIndex
CREATE INDEX "TripDocument_participantId_idx" ON "TripDocument"("participantId");

-- CreateIndex
CREATE INDEX "TripContribution_tripId_idx" ON "TripContribution"("tripId");

-- CreateIndex
CREATE INDEX "TripContribution_participantId_idx" ON "TripContribution"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_applicationShareToken_key" ON "Trip"("applicationShareToken");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TripParticipant_applicationId_key" ON "TripParticipant"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "TripParticipant_shareToken_key" ON "TripParticipant"("shareToken");

-- AddForeignKey
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TripApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripApplication" ADD CONSTRAINT "TripApplication_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMeeting" ADD CONSTRAINT "TripMeeting_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocumentRequirement" ADD CONSTRAINT "TripDocumentRequirement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TripDocumentRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripContribution" ADD CONSTRAINT "TripContribution_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripContribution" ADD CONSTRAINT "TripContribution_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


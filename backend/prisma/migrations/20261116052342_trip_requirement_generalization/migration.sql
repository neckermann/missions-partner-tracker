-- DropForeignKey
ALTER TABLE "TripDocument" DROP CONSTRAINT "TripDocument_requirementId_fkey";

-- DropForeignKey
ALTER TABLE "TripDocumentRequirement" DROP CONSTRAINT "TripDocumentRequirement_tripId_fkey";

-- DropTable
DROP TABLE "TripDocumentRequirement";

-- CreateTable
CREATE TABLE "TripRequirement" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'document',
    "dueAt" DATE,
    "reminderLeadDays" INTEGER,

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

-- CreateIndex
CREATE INDEX "TripRequirement_tripId_idx" ON "TripRequirement"("tripId");

-- CreateIndex
CREATE INDEX "TripRequirementStatus_participantId_idx" ON "TripRequirementStatus"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TripRequirementStatus_requirementId_participantId_key" ON "TripRequirementStatus"("requirementId", "participantId");

-- AddForeignKey
ALTER TABLE "TripRequirement" ADD CONSTRAINT "TripRequirement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequirementStatus" ADD CONSTRAINT "TripRequirementStatus_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TripRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequirementStatus" ADD CONSTRAINT "TripRequirementStatus_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocument" ADD CONSTRAINT "TripDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TripRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


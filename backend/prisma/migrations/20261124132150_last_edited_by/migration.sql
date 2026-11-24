-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Adult" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "CareTeamMember" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "ChurchVisit" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "ContactLog" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "DispatchRecord" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Furlough" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "PartnerFile" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "PartnerLanguage" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "PartnerLink" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "PrayerRequest" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "ReportSchedule" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "SavedReport" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "SendingParty" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "SupportEntry" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "SupportNeed" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripApplication" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripBudgetLine" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripContribution" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripDocument" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripFlightSegment" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripMeeting" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripParticipant" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripRequirement" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripRequirementStatus" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "TripType" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "lastEditedByName" TEXT;

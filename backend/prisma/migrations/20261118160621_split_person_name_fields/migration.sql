-- AlterTable
ALTER TABLE "Adult" DROP COLUMN "name",
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "ChurchSettings" DROP COLUMN "contactName",
ADD COLUMN     "contactFirstName" TEXT,
ADD COLUMN     "contactLastName" TEXT;

-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "contactName",
ADD COLUMN     "contactFirstName" TEXT,
ADD COLUMN     "contactLastName" TEXT;

-- AlterTable
ALTER TABLE "SendingParty" DROP COLUMN "contactName",
ADD COLUMN     "contactFirstName" TEXT,
ADD COLUMN     "contactLastName" TEXT;

-- AlterTable
ALTER TABLE "TripApplication" DROP COLUMN "emergencyContactName",
DROP COLUMN "parentGuardianName",
ADD COLUMN     "emergencyContactFirstName" TEXT,
ADD COLUMN     "emergencyContactLastName" TEXT,
ADD COLUMN     "parentGuardianFirstName" TEXT,
ADD COLUMN     "parentGuardianLastName" TEXT;

-- AlterTable
ALTER TABLE "TripParticipant" DROP COLUMN "emergencyContactName",
DROP COLUMN "parentGuardianName",
ADD COLUMN     "emergencyContactFirstName" TEXT,
ADD COLUMN     "emergencyContactLastName" TEXT,
ADD COLUMN     "parentGuardianFirstName" TEXT,
ADD COLUMN     "parentGuardianLastName" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "name",
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;


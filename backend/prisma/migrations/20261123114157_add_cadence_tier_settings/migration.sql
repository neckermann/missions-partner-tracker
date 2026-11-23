-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "cadenceBiweeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cadenceMonthlyEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cadenceQuarterlyEnabled" BOOLEAN NOT NULL DEFAULT true;

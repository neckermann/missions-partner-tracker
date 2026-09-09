-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "enabledFeatures" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "queueNotifyRestrictedPartners" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PendingNotification" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "reviewedText" TEXT;

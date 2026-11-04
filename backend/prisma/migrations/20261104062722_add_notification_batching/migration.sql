-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "digestDayOfMonth" INTEGER,
ADD COLUMN     "digestDayOfWeek" INTEGER,
ADD COLUMN     "digestFrequency" TEXT,
ADD COLUMN     "digestHour" INTEGER,
ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "queueNotifyNewsletters" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "queueNotifyOneTimeNeeds" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "queueNotifyPrayerRequests" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyByEmail" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PendingNotification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupmeSentAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "PendingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingNotification_type_idx" ON "PendingNotification"("type");

-- CreateIndex
CREATE INDEX "PendingNotification_partnerId_idx" ON "PendingNotification"("partnerId");

-- AddForeignKey
ALTER TABLE "PendingNotification" ADD CONSTRAINT "PendingNotification_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

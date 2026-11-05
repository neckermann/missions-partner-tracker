/*
  Warnings:

  - You are about to drop the column `notifyByEmail` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "lastBiweeklyScopedDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "lastMonthlyScopedDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "lastWeeklyScopedDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "scopedDigestDayOfMonth" INTEGER,
ADD COLUMN     "scopedDigestDayOfWeek" INTEGER,
ADD COLUMN     "scopedDigestHour" INTEGER;

-- AlterTable
ALTER TABLE "PendingNotification" ADD COLUMN     "biweeklyDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "monthlyDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "weeklyDigestSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "notifyByEmail",
ADD COLUMN     "allPartners" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "digestFrequency" TEXT;

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
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "allPartners" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PublicSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSubscriberPartner" (
    "subscriberId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "PublicSubscriberPartner_pkey" PRIMARY KEY ("subscriberId","partnerId")
);

-- CreateIndex
CREATE INDEX "UserFollowedPartner_partnerId_idx" ON "UserFollowedPartner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSubscriber_email_key" ON "PublicSubscriber"("email");

-- CreateIndex
CREATE INDEX "PublicSubscriber_confirmedAt_idx" ON "PublicSubscriber"("confirmedAt");

-- CreateIndex
CREATE INDEX "PublicSubscriberPartner_partnerId_idx" ON "PublicSubscriberPartner"("partnerId");

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollowedPartner" ADD CONSTRAINT "UserFollowedPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "PublicSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSubscriberPartner" ADD CONSTRAINT "PublicSubscriberPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

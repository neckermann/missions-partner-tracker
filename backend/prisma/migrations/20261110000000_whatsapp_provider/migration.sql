-- Additive only (nullable columns + one new table), so the previous app
-- version keeps working against this schema during a rolling deploy.

-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "whatsappPhoneNumber" TEXT,
ADD COLUMN     "whatsappPairedAt" TIMESTAMP(3),
ADD COLUMN     "whatsappCommunityId" TEXT,
ADD COLUMN     "whatsappCommunityName" TEXT,
ADD COLUMN     "whatsappPrayerGroupId" TEXT,
ADD COLUMN     "whatsappPrayerGroupName" TEXT,
ADD COLUMN     "whatsappOneTimeNeedGroupId" TEXT,
ADD COLUMN     "whatsappOneTimeNeedGroupName" TEXT,
ADD COLUMN     "whatsappNewsletterGroupId" TEXT,
ADD COLUMN     "whatsappNewsletterGroupName" TEXT,
ADD COLUMN     "lastWhatsappDigestSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotifiableEvent" ADD COLUMN     "whatsappSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppAuthEntry" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthEntry_pkey" PRIMARY KEY ("key")
);

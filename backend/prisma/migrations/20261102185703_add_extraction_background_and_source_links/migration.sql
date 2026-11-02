-- AlterTable
ALTER TABLE "PrayerRequest" ADD COLUMN     "sourceDocumentId" TEXT,
ADD COLUMN     "sourceNewsletterId" TEXT;

-- AlterTable
ALTER TABLE "SupportNeed" ADD COLUMN     "sourceDocumentId" TEXT,
ADD COLUMN     "sourceNewsletterId" TEXT;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_sourceNewsletterId_fkey" FOREIGN KEY ("sourceNewsletterId") REFERENCES "Newsletter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_sourceNewsletterId_fkey" FOREIGN KEY ("sourceNewsletterId") REFERENCES "Newsletter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

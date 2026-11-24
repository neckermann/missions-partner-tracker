-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "defaultCareLeadUserId" TEXT;

-- CreateTable
CREATE TABLE "KeyDateReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "occurrenceDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyDateReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyDateReminder_partnerId_idx" ON "KeyDateReminder"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "KeyDateReminder_userId_partnerId_kind_subjectId_occurrenceD_key" ON "KeyDateReminder"("userId", "partnerId", "kind", "subjectId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "KeyDateReminder" ADD CONSTRAINT "KeyDateReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDateReminder" ADD CONSTRAINT "KeyDateReminder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchSettings" ADD CONSTRAINT "ChurchSettings_defaultCareLeadUserId_fkey" FOREIGN KEY ("defaultCareLeadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

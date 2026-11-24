-- AlterTable
ALTER TABLE "Adult" ADD COLUMN     "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "contactInstructions" TEXT;

-- CreateTable
CREATE TABLE "ContactLog" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "topics" TEXT[],
    "contactedById" TEXT,
    "createdById" TEXT,
    "contactDate" DATE NOT NULL,
    "notes" TEXT,
    "followUpDate" DATE,
    "prayerRequestId" TEXT,
    "supportNeedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactLog_partnerId_contactDate_idx" ON "ContactLog"("partnerId", "contactDate");

-- CreateIndex
CREATE INDEX "ContactLog_contactedById_idx" ON "ContactLog"("contactedById");

-- CreateIndex
CREATE INDEX "ContactLog_followUpDate_idx" ON "ContactLog"("followUpDate");

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_contactedById_fkey" FOREIGN KEY ("contactedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one primary contact per partner. Prisma can't express a unique
-- index with a WHERE clause, so it's added here (same approach as
-- CareTeamMember_one_lead_per_partner).
CREATE UNIQUE INDEX "Adult_one_primary_contact_per_partner" ON "Adult"("partnerId") WHERE "isPrimaryContact";

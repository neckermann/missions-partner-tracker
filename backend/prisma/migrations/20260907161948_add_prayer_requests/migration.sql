-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "category" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "dateReceived" DATE NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ongoing',
    "dateAnswered" DATE,
    "answeredNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PrayerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrayerRequest_missionaryId_idx" ON "PrayerRequest"("missionaryId");

-- CreateIndex
CREATE INDEX "PrayerRequest_organizationId_idx" ON "PrayerRequest"("organizationId");

-- CreateIndex
CREATE INDEX "PrayerRequest_category_idx" ON "PrayerRequest"("category");

-- CreateIndex
CREATE INDEX "PrayerRequest_status_idx" ON "PrayerRequest"("status");

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

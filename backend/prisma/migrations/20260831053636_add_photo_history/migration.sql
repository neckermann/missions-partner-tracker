-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "url" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Photo_missionaryId_idx" ON "Photo"("missionaryId");

-- CreateIndex
CREATE INDEX "Photo_organizationId_idx" ON "Photo"("organizationId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint (same "belongs to exactly one parent" rule as SupportEntry/SupportNeed/Newsletter/ChurchVisit)
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_one_parent_check"
    CHECK (
        ("missionaryId" IS NOT NULL AND "organizationId" IS NULL) OR
        ("missionaryId" IS NULL AND "organizationId" IS NOT NULL)
    );

-- DataMigration: carry each existing images->>'photo' value forward into a
-- Photo row before the column is dropped, so no upload history is lost.
-- receivedDate is set to the record's updatedAt (best available signal for
-- when that photo was actually set) since the original received date was
-- never tracked.
INSERT INTO "Photo" ("id", "missionaryId", "url", "receivedDate", "createdAt")
SELECT gen_random_uuid(), "id", "images"->>'photo', "updatedAt"::date, "updatedAt"
FROM "Missionary"
WHERE "images"->>'photo' IS NOT NULL;

INSERT INTO "Photo" ("id", "organizationId", "url", "receivedDate", "createdAt")
SELECT gen_random_uuid(), "id", "images"->>'photo', "updatedAt"::date, "updatedAt"
FROM "Organization"
WHERE "images"->>'photo' IS NOT NULL;

-- DropColumn
ALTER TABLE "Missionary" DROP COLUMN "images";

-- DropColumn
ALTER TABLE "Organization" DROP COLUMN "images";

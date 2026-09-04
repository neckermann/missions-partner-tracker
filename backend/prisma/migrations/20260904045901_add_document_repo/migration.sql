-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "missionaryId" TEXT,
    "organizationId" TEXT,
    "category" TEXT NOT NULL,
    "customCategory" TEXT,
    "title" TEXT,
    "receivedDate" DATE NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_missionaryId_idx" ON "Document"("missionaryId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_category_idx" ON "Document"("category");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_missionaryId_fkey" FOREIGN KEY ("missionaryId") REFERENCES "Missionary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

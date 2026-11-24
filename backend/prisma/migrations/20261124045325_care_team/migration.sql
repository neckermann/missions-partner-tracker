-- CreateTable
CREATE TABLE "CareTeamMember" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareTeamMember_userId_idx" ON "CareTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CareTeamMember_partnerId_userId_key" ON "CareTeamMember"("partnerId", "userId");

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added (CONTRIBUTING.md "Database migrations"): at most one lead per
-- partner. Prisma's schema language can't express a partial unique index;
-- routes/careTeams.js also enforces this inside a transaction so a caller
-- gets a clear error rather than this constraint's.
CREATE UNIQUE INDEX "CareTeamMember_one_lead_per_partner" ON "CareTeamMember"("partnerId") WHERE "isLead";

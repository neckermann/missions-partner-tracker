/*
  Warnings (data is carried over by the backfill below before the drop):

  - You are about to drop the column `expiresAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `scopedTripId` on the `User` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "TripAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetEmail" TEXT,
    "tripId" TEXT,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripAccess_tripId_idx" ON "TripAccess"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripAccess_userId_tripId_key" ON "TripAccess"("userId", "tripId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "AuditLog_tripId_idx" ON "AuditLog"("tripId");

-- AddForeignKey
ALTER TABLE "TripAccess" ADD CONSTRAINT "TripAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripAccess" ADD CONSTRAINT "TripAccess_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added data backfill (CONTRIBUTING.md "Database migrations"): carry
-- every existing Trip Leader login over to the guest role before the
-- columns that described its scope are dropped. Its single scopedTripId
-- becomes one TripAccess row, and an admin-set User.expiresAt becomes that
-- grant's expiresAt override (null stays null, i.e. the derived
-- trip end date + 30 days applies from now on).
INSERT INTO "TripAccess" ("id", "userId", "tripId", "expiresAt", "createdAt")
SELECT gen_random_uuid()::text, "id", "scopedTripId", "expiresAt", CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'tripLeader' AND "scopedTripId" IS NOT NULL;

UPDATE "User" SET "role" = 'guest' WHERE "role" = 'tripLeader';

-- The old guest tier made MFA an optional admin checkbox; guests now
-- require it, so anyone carried over must enrol at next sign-in.
UPDATE "User" SET "mfaSetupRequired" = true WHERE "role" = 'guest' AND "mfaEnabled" = false;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_scopedTripId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "expiresAt",
DROP COLUMN "scopedTripId";

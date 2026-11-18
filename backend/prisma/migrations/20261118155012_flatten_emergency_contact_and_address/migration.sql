/*
  Warnings:

  - You are about to drop the column `address` on the `ChurchSettings` table. All the data in the column will be lost.
  - You are about to drop the column `emergencyContact` on the `Partner` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ChurchSettings" DROP COLUMN "address",
ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "stateProvinceRegion" TEXT;

-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "emergencyContact",
ADD COLUMN     "emergencyContactEmail" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT;

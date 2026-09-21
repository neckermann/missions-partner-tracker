/*
  Warnings:

  - You are about to drop the column `ssoProviderId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `SsoProvider` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_ssoProviderId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "ssoProviderId";

-- DropTable
DROP TABLE "SsoProvider";

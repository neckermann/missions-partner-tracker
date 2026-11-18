-- AlterTable
ALTER TABLE "ChurchSettings" DROP COLUMN "logoBytes";

-- AlterTable
ALTER TABLE "InboundEmail" DROP COLUMN "bytes";

-- AlterTable
ALTER TABLE "PartnerFile" DROP COLUMN "bytes";

-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "bytes";

-- AlterTable
ALTER TABLE "TripDocument" DROP COLUMN "bytes",
DROP COLUMN "signatureImage";

-- AlterTable
ALTER TABLE "TripParticipant" DROP COLUMN "photo";

-- CreateTable
CREATE TABLE "TripParticipantPhoto" (
    "id" TEXT NOT NULL,
    "photo" BYTEA NOT NULL,

    CONSTRAINT "TripParticipantPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDocumentBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "signatureImage" BYTEA,

    CONSTRAINT "TripDocumentBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerFileBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "PartnerFileBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmailBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "InboundEmailBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoBytes" (
    "id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "PhotoBytes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchSettingsLogo" (
    "id" TEXT NOT NULL,
    "logoBytes" BYTEA NOT NULL,

    CONSTRAINT "ChurchSettingsLogo_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TripParticipantPhoto" ADD CONSTRAINT "TripParticipantPhoto_id_fkey" FOREIGN KEY ("id") REFERENCES "TripParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDocumentBytes" ADD CONSTRAINT "TripDocumentBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "TripDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerFileBytes" ADD CONSTRAINT "PartnerFileBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "PartnerFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmailBytes" ADD CONSTRAINT "InboundEmailBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "InboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoBytes" ADD CONSTRAINT "PhotoBytes_id_fkey" FOREIGN KEY ("id") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchSettingsLogo" ADD CONSTRAINT "ChurchSettingsLogo_id_fkey" FOREIGN KEY ("id") REFERENCES "ChurchSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


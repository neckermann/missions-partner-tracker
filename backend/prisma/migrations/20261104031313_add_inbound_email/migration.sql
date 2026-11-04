-- AlterTable
ALTER TABLE "ChurchSettings" ADD COLUMN     "inboundEmailWebhookUsername" TEXT,
ADD COLUMN     "inboundEmailWebhookPassword" TEXT;

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bytes" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

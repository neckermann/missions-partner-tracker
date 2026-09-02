-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "allowedDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "ssoProviderId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ssoProviderId_fkey" FOREIGN KEY ("ssoProviderId") REFERENCES "SsoProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: the old SAML integration only ever wrote authProvider
-- "entra" for SSO users, with no SsoProvider row to link to (SSO config
-- lived in env vars, not the DB, before this migration). Leave those users'
-- authProvider as-is (still accurate — they did sign in via Entra) and
-- ssoProviderId NULL; they'll get linked to a real SsoProvider row
-- automatically the next time they sign in once an admin configures one in
-- Church Settings.

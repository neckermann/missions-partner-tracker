-- True renames (not drop+add) to preserve existing seeded demo data
ALTER TABLE "ChurchSettings" RENAME COLUMN "allowPublicFundraisingLinks" TO "allowPublicSupportRaisingLinks";
ALTER TABLE "Trip" RENAME COLUMN "fundraisingGoal" TO "supportRaisingGoal";
ALTER TABLE "TripParticipant" RENAME COLUMN "fundraisingGoal" TO "supportRaisingGoal";

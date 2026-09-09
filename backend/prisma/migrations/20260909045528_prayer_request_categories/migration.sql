-- AlterTable
ALTER TABLE "PrayerRequest" ADD COLUMN     "includeInBooklet" BOOLEAN NOT NULL DEFAULT false;

-- Rename category values: the old short_term/long_term split (time
-- horizon) becomes strategic/situational (what the request actually is).
-- long_term -> strategic and short_term -> situational is an
-- approximation, not a perfect semantic match (e.g. a long-running health
-- battle was "long_term" but is really "situational"), but it's the
-- closest existing signal available and this data is all seed/demo
-- content, not anything a real deployment depends on yet.
UPDATE "PrayerRequest" SET "category" = 'strategic' WHERE "category" = 'long_term';
UPDATE "PrayerRequest" SET "category" = 'situational' WHERE "category" = 'short_term';

import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import PublicSubscribeForm from "../components/PublicSubscribeForm.jsx";

// Public, no-login "subscribe to prayer updates" page (#202, replacing the
// Prayer Wall activity feed -- see that removal's own history for why: a
// feed built on the notification send-queue empties out the moment a
// scheduled digest actually fires). Just the subscribe form, with a
// picker for all-partners vs. several specific ones. Mirrors
// PublicDirectory.jsx's masthead/banner shape, not an admin-shell login
// idiom -- there's no login here.
export default function PublicSubscribe() {
  const { partnerTermPlural } = useSettings();
  const plural = partnerTermPlural.toLowerCase();

  return (
    <div>
      <PublicSiteHeader title={`Pray for our ${partnerTermPlural}`} />

      <DemoBanner />

      <div className="admin-shell">
        <p style={{ color: "#555" }}>
          Get an email when there's a new or answered prayer request — for all of our {plural}, or just the
          ones you choose. These are prayer requests we receive from our partners, gathered from their
          newsletters and other updates to us — not a substitute for a partner's own newsletter. Visit any
          partner's page to sign up for theirs directly if they offer one.
        </p>

        <blockquote className="scripture-quote">
          <p>
            Therefore take up the whole armor of God, that you may be able to withstand in the evil day, and
            having done all, to stand firm. Stand therefore, having fastened on the belt of truth, and having
            put on the breastplate of righteousness, and, as shoes for your feet, having put on the readiness
            given by the gospel of peace. In all circumstances take up the shield of faith, with which you can
            extinguish all the flaming darts of the evil one; and take the helmet of salvation, and the sword
            of the Spirit, which is the word of God, praying at all times in the Spirit, with all prayer and
            supplication. To that end, keep alert with all perseverance, making supplication for all the
            saints, and also for me, that words may be given to me in opening my mouth boldly to proclaim the
            mystery of the gospel, for which I am an ambassador in chains, that I may declare it boldly, as I
            ought to speak.
          </p>
          <cite>— Ephesians 6:13–20 (ESV)</cite>
        </blockquote>

        <PublicSubscribeForm
          picker
          title="Get prayer updates by email"
          description={`Choose all of our ${plural}, or pick specific ones to follow.`}
        />
      </div>
    </div>
  );
}

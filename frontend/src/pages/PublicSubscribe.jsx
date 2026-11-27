import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import PublicSubscribeForm from "../components/PublicSubscribeForm.jsx";

// Public, no-login "subscribe to prayer updates" page: a subscribe form with a picker for all partners or
// specific ones. Mirrors PublicDirectory.jsx's masthead/banner shape.
export default function PublicSubscribe() {
  const { partnerTermPlural, subscribePassage, subscribePassageSource } = useSettings();
  const plural = partnerTermPlural.toLowerCase();

  return (
    <div>
      <PublicSiteHeader title={`Pray for our ${partnerTermPlural}`} />

      <DemoBanner />

      <div className="admin-shell">
        <p style={{ color: "var(--muted)" }}>
          Get an email when there's a new or answered prayer request — for all of our {plural}, or just the
          ones you choose. These are prayer requests we receive from our partners, gathered from their
          newsletters and other updates to us — not a substitute for a partner's own newsletter. Visit any
          partner's page to sign up for theirs directly if they offer one.
        </p>

        {subscribePassage && (
          <blockquote className="scripture-quote">
            <p style={{ whiteSpace: "pre-line" }}>{subscribePassage}</p>
            {subscribePassageSource && <cite>— {subscribePassageSource}</cite>}
          </blockquote>
        )}

        <PublicSubscribeForm
          picker
          title="Get prayer updates by email"
          description={`Choose all of our ${plural}, or pick specific ones to follow.`}
        />
      </div>
    </div>
  );
}

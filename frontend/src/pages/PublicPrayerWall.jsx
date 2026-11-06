import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPrayerWall } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import PublicSubscribeForm from "../components/PublicSubscribeForm.jsx";

// Public, no-login "recent prayer activity" page (#202) -- also the
// "subscribe to everyone" collection point, via the form placed right
// after a first glimpse of content (not above it) so a visitor sees
// what they'd actually be signing up for first. Mirrors
// PublicDirectory.jsx's masthead/banner shape, not AdminPendingNotifications'
// admin-shell idiom -- there's no login here.
export default function PublicPrayerWall() {
  const [activity, setActivity] = useState(null);
  const { logo, partnerTermPlural } = useSettings();

  useEffect(() => {
    fetchPrayerWall()
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  // Grouped by partner, in the order each partner's most recent item
  // appeared -- the feed itself already comes back newest-first (see
  // routes/publicPrayerWall.js), so the first time a partnerId is seen
  // fixes that partner's position in the grouped list too.
  const groups = useMemo(() => {
    if (!activity) return [];
    const byPartner = new Map();
    for (const item of activity) {
      if (!byPartner.has(item.partnerId)) {
        byPartner.set(item.partnerId, {
          partnerId: item.partnerId,
          partnerName: item.partnerName,
          items: [],
        });
      }
      byPartner.get(item.partnerId).items.push(item);
    }
    return [...byPartner.values()];
  }, [activity]);

  return (
    <div>
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
          <h1>Prayer Wall</h1>
        </div>
        <Link to="/" style={{ color: "white" }}>
          View {partnerTermPlural}
        </Link>
      </header>

      <DemoBanner />

      <div className="admin-shell">
        <p style={{ color: "#555" }}>
          Recent prayer-request activity from our {partnerTermPlural.toLowerCase()}. Subscribe below to get
          these by email as they come in.
        </p>

        <PublicSubscribeForm
          allPartners={true}
          title="Get prayer updates by email"
          description={`Hear about new and answered prayer requests from all of our ${partnerTermPlural.toLowerCase()}.`}
        />

        {activity === null && <p>Loading...</p>}
        {activity !== null && groups.length === 0 && <p>No recent prayer-request activity to show yet.</p>}

        {groups.map((group) => (
          <div key={group.partnerId} className="prayer-wall-group">
            <h3>
              <Link to={`/partners/${group.partnerId}`}>{group.partnerName}</Link>
            </h3>
            {group.items.map((item) => (
              <div key={item.id} className="prayer-wall-item">
                <p className="prayer-wall-item-summary">
                  {item.emoji} {item.summary}
                </p>
                <p>{item.bodyText}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

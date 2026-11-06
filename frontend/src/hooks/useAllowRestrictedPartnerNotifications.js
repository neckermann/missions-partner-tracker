import { useEffect, useState } from "react";
import { fetchChurchSettings } from "../api/client.js";

// Whether a restricted partner's events are ever recorded at all --
// gates "Review and approve now" on every creation form (the "Mark as
// urgent" checkbox's own visibility is hasEnabledChannel, unrelated to
// this setting -- see PrayerRequestSection.jsx): when this is off,
// recordEvent's own isRestrictedPartnerBlocked check
// (notificationRecording.js) drops the row before it's ever queued, so
// checking "approve now" would silently do nothing -- the control
// shouldn't be offered in the first place, not just left to no-op.
//
// Fetched via the main settings endpoint (GET /api/settings, gated only
// by requireAuth) rather than the admin-only GET /api/settings/notifications
// -- editor accounts use these creation forms too, and this is a read, not
// a write, so it doesn't need the stricter admin-only gate that route's
// own settings-management PUT has.
//
// Defaults to true while loading -- this is a UI convenience gate, not
// the real safety check (that's still enforced server-side regardless of
// what this returns), so briefly showing the control before the real
// value arrives is harmless; getting stuck hidden on a fetch failure
// would be the worse failure mode.
export default function useAllowRestrictedPartnerNotifications() {
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    fetchChurchSettings()
      .then((settings) => setAllowed(settings.allowRestrictedPartnerNotifications !== false))
      .catch(() => {});
  }, []);

  return allowed;
}

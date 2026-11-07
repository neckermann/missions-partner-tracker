import { useEffect, useState } from "react";
import { fetchChurchSettings } from "../api/client.js";

// Whether a restricted partner's events are recorded at all -- gates
// "Review and approve now" on creation forms (unrelated to "Mark as
// urgent", which uses hasEnabledChannel): when this is off, recordEvent
// drops the row before it's ever queued, so offering "approve now" would
// silently no-op. Uses GET /api/settings (requireAuth only), not the
// admin-only /settings/notifications, since editors use these forms too
// and this is a read. Defaults to true while loading -- a UI convenience
// gate only, so briefly over-showing the control is harmless; the real
// check is still enforced server-side regardless of what this returns.
export default function useAllowRestrictedPartnerNotifications() {
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    fetchChurchSettings()
      .then((settings) => setAllowed(settings.allowRestrictedPartnerNotifications !== false))
      .catch(() => {});
  }, []);

  return allowed;
}

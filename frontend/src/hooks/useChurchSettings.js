import { useEffect, useState } from "react";
import { fetchChurchSettings } from "../api/client.js";

// One shared fetch-on-mount for GET /api/settings (requireAuth only, no
// role restriction), replacing what used to be five independent
// hand-rolled useState/useEffect pairs across the Site Administration
// pages plus a one-off hook built for a single boolean
// (useAllowRestrictedPartnerDispatch, now folded into this). Each
// caller still derives its own local form/display state from `settings`
// exactly as before -- this hook only replaces the fetch mechanism, not
// any page's downstream shape, error copy, or save logic.
export default function useChurchSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchChurchSettings()
      .then(setSettings)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  return { settings, loading, error };
}

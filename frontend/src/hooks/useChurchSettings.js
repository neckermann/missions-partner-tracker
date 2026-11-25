import { useEffect, useState } from "react";
import { fetchChurchSettings } from "../api/client.js";

// One shared fetch-on-mount for GET /api/settings (requireAuth, any role). Each caller derives its
// own form/display state from `settings`.
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

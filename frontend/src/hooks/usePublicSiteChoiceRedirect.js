import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChurchSettings } from "../api/client.js";

// The first time an admin reaches the admin area on a site that has never decided whether to publish its
// partners (neither public switch is stored yet), send them to the one-time question. Both answers
// store both switches, so this never repeats. Only admins can answer it.
export default function usePublicSiteChoiceRedirect(isAdmin) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAdmin) return;
    fetchChurchSettings()
      .then((settings) => {
        const stored = settings?.enabledFeatures || {};
        if (stored.publicDirectory === undefined && stored.publicMap === undefined) {
          navigate("/admin/public-site", { replace: true });
        }
      })
      .catch(() => {});
  }, [isAdmin, navigate]);
}

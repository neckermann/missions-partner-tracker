import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChurchSettings, fetchUsers } from "../api/client.js";

// Remembered per browser, never needed for correctness: the Home page's "You are the only administrator" reminder
// is what persists. This only stops the one-time screen coming back after it has been answered or skipped.
const ASKED_KEY = "addAdministratorAsked";

export function markAddAdministratorAsked() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Storage can be blocked; the step then simply shows again next time, and is skippable.
  }
}

function addAdministratorAsked() {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

async function onlyOneAdministrator() {
  try {
    const users = await fetchUsers();
    return users.filter((u) => u.role === "admin" && u.active !== false).length === 1;
  } catch {
    return false;
  }
}

// The first time an admin reaches the admin area on a site that has never decided whether to publish its
// partners (neither public switch is stored yet), which is a brand-new site, send them through two one-time
// screens: first "add a second administrator" (skippable, and only while there is just the one), then the
// question about the public site. Both answers store what they need, so neither repeats. Only admins see them.
export default function usePublicSiteChoiceRedirect(isAdmin) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    (async () => {
      try {
        const settings = await fetchChurchSettings();
        const stored = settings?.enabledFeatures || {};
        if (stored.publicDirectory !== undefined || stored.publicMap !== undefined) return;
        if (!addAdministratorAsked() && (await onlyOneAdministrator())) {
          if (live) navigate("/admin/add-administrator", { replace: true });
          return;
        }
        if (live) navigate("/admin/public-site", { replace: true });
      } catch {
        // The screens are a convenience; a failed lookup just means no redirect.
      }
    })();
    return () => {
      live = false;
    };
  }, [isAdmin, navigate]);
}

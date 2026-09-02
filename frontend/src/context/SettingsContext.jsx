import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchPublicSettings } from "../api/client.js";

// The one piece of shared/global state in this app (every other page fetches
// its own data independently) — justified because these settings are read by
// nearly every page: every admin page renders the AdminSidebar, every public page
// renders a header. Always reads the public endpoint regardless of login
// state, since none of this is sensitive (address/phone/contact fields are
// deliberately withheld server-side — see routes/publicSettings.js) and it
// needs to work identically for a logged-out visitor and a logged-in admin.
const DEFAULTS = {
  churchName: null,
  logo: null,
  primaryColor: null,
  partnerTermSingular: "Missionary",
  partnerTermPlural: "Missionaries",
  usePartnerTermInAdmin: false,
  publicTagline: null,
  aboutText: null,
};

const SettingsContext = createContext({ ...DEFAULTS, loading: true });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULTS, loading: true });

  useEffect(() => {
    fetchPublicSettings()
      .then((data) => setSettings({ ...DEFAULTS, ...data, loading: false }))
      .catch(() => setSettings({ ...DEFAULTS, loading: false }));
  }, []);

  // Both side effects are harmless no-ops on an unconfigured instance
  // (primaryColor/churchName stay null), so nothing changes until a church
  // actually sets them in Church Settings.
  useEffect(() => {
    if (settings.primaryColor) {
      document.documentElement.style.setProperty("--brand-color", settings.primaryColor);
    }
  }, [settings.primaryColor]);

  useEffect(() => {
    if (settings.churchName) {
      document.title = `${settings.churchName} | ${settings.partnerTermPlural}`;
    }
  }, [settings.churchName, settings.partnerTermPlural]);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

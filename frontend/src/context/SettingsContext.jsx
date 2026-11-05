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
  headerColor: null,
  highlightColor: null,
  brandFont: null,
  partnerTermSingular: "Missionary",
  partnerTermPlural: "Missionaries",
  usePartnerTermInAdmin: false,
  publicTagline: null,
  aboutText: null,
  // Demo-mode banner fields -- see the comment on these in
  // routes/publicSettings.js. null/false here (not just omitted) so
  // DemoBanner.jsx's `if (!isDemo) return null` is correct even before
  // the first fetch resolves, same reasoning as the rest of this object.
  isDemo: false,
  demoLoginEmail: null,
  demoLoginPassword: null,
  // Resolved booleans (env-var checks already applied server-side, see
  // routes/publicSettings.js) -- every key defaults to true here so a page
  // never flashes "disabled" while this first fetch is still in flight,
  // except aiExtraction, groupme, and joshuaProject, whose real registry
  // default is off.
  enabledFeatures: {
    newsletters: true,
    documents: true,
    publicDirectory: true,
    publicMap: true,
    aiExtraction: false,
    prayerRequests: true,
    oneTimeNeeds: true,
    monthlySupport: true,
    trips: true,
    booklet: true,
    reports: true,
    groupme: false,
    joshuaProject: false,
  },
};

const SettingsContext = createContext({ ...DEFAULTS, loading: true, refreshSettings: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULTS, loading: true });

  // Extracted so a page that just changed a setting this context carries
  // (Enabled Features, the Email page's own inline toggles, Branding,
  // ...) can call refreshSettings() afterward instead of leaving the
  // sidebar/Home tiles showing stale data until a full page reload --
  // this context only ever fetches once on mount otherwise.
  function loadSettings() {
    return fetchPublicSettings()
      .then((data) => setSettings({ ...DEFAULTS, ...data, loading: false }))
      .catch(() => setSettings({ ...DEFAULTS, loading: false }));
  }

  useEffect(() => {
    loadSettings();
  }, []);

  // All five side effects below are harmless no-ops on an unconfigured
  // instance (every field stays null), so nothing changes until a church
  // actually sets them in Church Settings. primaryColor drives --brand-color
  // (the ACCENT role: buttons, links, headings, letterhead -- see its
  // comment in schema.prisma), headerColor/highlightColor are the other two
  // brand colors, brandFont is the font choice.
  useEffect(() => {
    if (settings.primaryColor) {
      document.documentElement.style.setProperty("--brand-color", settings.primaryColor);
    } else {
      document.documentElement.style.removeProperty("--brand-color");
    }
  }, [settings.primaryColor]);

  useEffect(() => {
    if (settings.headerColor) {
      document.documentElement.style.setProperty("--brand-header-color", settings.headerColor);
    } else {
      document.documentElement.style.removeProperty("--brand-header-color");
    }
  }, [settings.headerColor]);

  useEffect(() => {
    if (settings.highlightColor) {
      document.documentElement.style.setProperty("--brand-highlight-color", settings.highlightColor);
    } else {
      document.documentElement.style.removeProperty("--brand-highlight-color");
    }
  }, [settings.highlightColor]);

  useEffect(() => {
    if (settings.brandFont) {
      document.documentElement.style.setProperty("--brand-font", settings.brandFont);
    } else {
      document.documentElement.style.removeProperty("--brand-font");
    }
  }, [settings.brandFont]);

  useEffect(() => {
    if (settings.churchName) {
      document.title = `${settings.churchName} | ${settings.partnerTermPlural}`;
    }
  }, [settings.churchName, settings.partnerTermPlural]);

  return (
    <SettingsContext.Provider value={{ ...settings, refreshSettings: loadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

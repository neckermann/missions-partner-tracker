import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchPublicSettings } from "../api/client.js";
import { setChurchCurrency } from "../utils/format.js";

// The one piece of global state: read by nearly every page (sidebar, public header). Always reads
// the public endpoint, whose contact fields are withheld server-side (routes/publicSettings.js),
// so it works the same logged out or in.
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
  // What this church calls the group that looks after partners with no care team (routes/publicSettings.js).
  ownerGroupName: "Missions team",
  publicTagline: null,
  aboutText: null,
  subscribePassage: null,
  subscribePassageSource: null,
  // The one currency every amount is shown in (utils/format.js, routes/publicSettings.js).
  currency: "USD",
  // The country a phone number typed without a "+" is read in (utils/phone.js, components/shared/PhoneInput.jsx).
  defaultPhoneCountry: "US",
  // The church's own time zone; trip meeting and flight times are shown in it for everyone (utils/churchTime.js).
  timezone: "America/Chicago",
  // Demo banner fields (routes/publicSettings.js). null/false, not omitted, so DemoBanner is correct
  // before the first fetch resolves.
  isDemo: false,
  demoLoginEmail: null,
  demoLoginPassword: null,
  demoGuestLogins: [],
  // Resolved booleans (routes/publicSettings.js). Keys default to true so a page never flashes
  // "disabled" while loading, except aiExtraction, groupme, whatsapp and joshuaProject, which
  // default off.
  enabledFeatures: {
    partnerFiles: true,
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
    whatsapp: false,
    joshuaProject: false,
  },
  // Email-digest cadence tiers an admin offers. Defaults match ChurchSettings' column defaults so a
  // page never flashes a tier that is about to disappear.
  cadenceTiersEnabled: {
    biweekly: false,
    monthly: true,
    quarterly: true,
  },
};

const SettingsContext = createContext({ ...DEFAULTS, loading: true, refreshSettings: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULTS, loading: true });

  // Exposed so a page that changes a setting this context carries can refresh it; otherwise it only
  // fetches on mount.
  function loadSettings() {
    return fetchPublicSettings()
      .then((data) => setSettings({ ...DEFAULTS, ...data, loading: false }))
      .catch(() => setSettings({ ...DEFAULTS, loading: false }));
  }

  useEffect(() => {
    loadSettings();
  }, []);

  // No-ops on an unconfigured instance (every field stays null). primaryColor drives --brand-color
  // (the accent role); headerColor/highlightColor are the other brand colors, brandFont the font.
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

  // Set during render, before any child reads it. Keyed on the currency so the app below is built again when
  // it changes (once at load for a church not on dollars, or when an admin changes it): amounts and labels are
  // written by plain functions that do not re-run on a context change by themselves.
  setChurchCurrency(settings.currency);
  return (
    <SettingsContext.Provider value={{ ...settings, refreshSettings: loadSettings }}>
      <React.Fragment key={settings.currency}>{children}</React.Fragment>
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

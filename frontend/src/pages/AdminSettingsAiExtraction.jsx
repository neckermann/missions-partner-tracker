import React from "react";
import { fetchAiExtractionSettings, updateAiExtractionSettings } from "../api/client.js";
import ApiKeySettingsPage from "../components/admin/ApiKeySettingsPage.jsx";

// Just an API key -- same shape as AdminSettingsJoshuaProject.jsx. Whether
// the feature actually runs is controlled separately in Enabled Features
// (the "AI Features" toggle), not here.
export default function AdminSettingsAiExtraction() {
  return (
    <ApiKeySettingsPage
      title="AI Features"
      description={
        <>
          Scans uploaded newsletters and documents for prayer requests and one-time needs using Claude
          (Anthropic). Turn it on in <a href="/admin/settings/features">Enabled Features</a> once a key is
          saved below. Usage is pay-per-scan on the key owner's Anthropic account — a few cents/month at
          typical volume, not a flat fee.
        </>
      }
      instructions={
        <>
          Get an API key at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          .
        </>
      }
      loadErrorMessage="Couldn't load AI request scanning settings."
      saveErrorMessage="Couldn't save the API key."
      fetchSettings={fetchAiExtractionSettings}
      updateSettings={updateAiExtractionSettings}
    />
  );
}

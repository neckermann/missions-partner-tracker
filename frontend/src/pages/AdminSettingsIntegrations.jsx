import React from "react";
import {
  fetchAiExtractionSettings,
  updateAiExtractionSettings,
  fetchJoshuaProjectSettings,
  updateJoshuaProjectSettings,
} from "../api/client.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import ApiKeySettingsPage from "../components/admin/ApiKeySettingsPage.jsx";

export default function AdminSettingsIntegrations() {
  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Integrations" />
      <p style={{ color: "#555" }}>External services this app can connect to.</p>

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
        textField={{
          key: "model",
          label: "Model",
          placeholder: "App default",
          helpText: (
            <>
              Anthropic model id to use for scanning, e.g. <code>claude-opus-5</code>. Leave blank to use this
              app's built-in default.
            </>
          ),
        }}
      />

      <div style={{ marginTop: "1rem" }}>
        <ApiKeySettingsPage
          title="Joshua Project"
          description={
            <>
              Shows country-level unreached-people-group statistics on a partner's page. Turn it on in{" "}
              <a href="/admin/settings/features">Enabled Features</a> once a key is saved below.
            </>
          }
          instructions={
            <>
              Get a free API key at{" "}
              <a href="https://joshuaproject.net/api/request" target="_blank" rel="noreferrer">
                joshuaproject.net/api/request
              </a>
              .
            </>
          }
          loadErrorMessage="Couldn't load Joshua Project settings."
          saveErrorMessage="Couldn't save the API key."
          fetchSettings={fetchJoshuaProjectSettings}
          updateSettings={updateJoshuaProjectSettings}
        />
      </div>
    </div>
  );
}

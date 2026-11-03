import React from "react";
import { fetchJoshuaProjectSettings, updateJoshuaProjectSettings } from "../api/client.js";
import ApiKeySettingsPage from "../components/admin/ApiKeySettingsPage.jsx";

// Just an API key -- unlike GroupMe, there's no group/topic picker here,
// so this page is a lot smaller than AdminSettingsGroupMe.jsx. Whether the
// resulting country stats actually show up at all is controlled
// separately in Enabled Features (the "Joshua Project stats" toggle), not
// here -- once both are true it shows everywhere it always has (a
// partner's admin page and public page, wherever a FIPS country code is
// on file), same as every other feature in this app being a plain on/off.
export default function AdminSettingsJoshuaProject() {
  return (
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
  );
}

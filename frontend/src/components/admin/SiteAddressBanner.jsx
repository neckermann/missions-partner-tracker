import React from "react";
import useCurrentUser from "../../hooks/useCurrentUser.js";

// Passkeys only work at the one web address the site is set to (APP_BASE_URL). When an admin is browsing at a
// different one (www vs the bare domain, the old onrender.com address after a custom domain was added) the people
// who sign in with a passkey are locked out of that address and get nothing useful to act on, so the admin is told
// here, in plain words, which address is the right one. Admins only; nothing shows when the addresses match, when
// none is set, or while the page is still loading.
export default function SiteAddressBanner({ here = window.location.origin }) {
  const { configuredSiteOrigin } = useCurrentUser();
  if (!configuredSiteOrigin || configuredSiteOrigin === here) return null;
  return (
    <div
      role="alert"
      className="no-print"
      style={{
        padding: "0.6rem 1rem",
        background: "var(--warn-soft)",
        borderBottom: "1px solid var(--warn)",
        color: "var(--text)",
        fontSize: "0.9rem",
      }}
    >
      <strong>
        You are at {here}, but this site is set to {configuredSiteOrigin}.
      </strong>{" "}
      Passkeys only work at {configuredSiteOrigin}, so anyone using one will be turned away here. Open the
      site at <a href={configuredSiteOrigin}>{configuredSiteOrigin}</a>, or, if that is the old address, have
      whoever runs the site update <code>APP_BASE_URL</code> (ADMIN_GUIDE, "Authentication setup").
    </div>
  );
}

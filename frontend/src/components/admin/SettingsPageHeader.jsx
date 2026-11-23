import React from "react";
import Breadcrumb from "../shared/Breadcrumb.jsx";

// The one piece of chrome every Settings sub-page was missing (Phase 4 of
// the UX-rebuild plan): a consistent way back. There is no dedicated
// Settings landing page beyond `/admin/settings` itself (which redirects
// to About & Branding) -- the sidebar's own Settings group already lists
// every sub-page whenever it's expanded, so this breadcrumb is a fallback
// for whenever that group isn't open (a direct link, or a narrow viewport
// where the sidebar is collapsed), not a second nav system.
// `crumbLabel` lets a caller use a shorter/cleaner breadcrumb segment than
// its own `title` when the title carries extra detail (e.g. a live count).
export default function SettingsPageHeader({ title, actions = null, crumbLabel }) {
  return (
    <>
      <Breadcrumb items={[{ label: "Settings", to: "/admin/settings" }, { label: crumbLabel || title }]} />
      {actions ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ marginBottom: 0 }}>{title}</h2>
          {actions}
        </div>
      ) : (
        <h2>{title}</h2>
      )}
    </>
  );
}

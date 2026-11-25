import React from "react";
import Breadcrumb from "../shared/Breadcrumb.jsx";

// A consistent way back for every Settings sub-page. The sidebar's Settings group already lists
// every sub-page, so this breadcrumb is a fallback for when that group is closed (a direct link,
// a narrow viewport). `crumbLabel` gives a shorter breadcrumb than `title` when the title carries
// extra detail (e.g. a live count).
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

import React from "react";

// The heading block at the top of an admin list page: the title, an optional one-line count
// (`subtitle`), the page's main buttons on the right (`actions`), and an optional short
// `description` underneath. Settings sub-pages use SettingsPageHeader (it adds the breadcrumb).
export default function PageHeader({ title, subtitle = null, description = null, actions = null }) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {description && <p className="page-header-description">{description}</p>}
    </div>
  );
}

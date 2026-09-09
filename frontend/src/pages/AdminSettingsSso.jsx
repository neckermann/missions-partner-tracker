import React from "react";
import SsoProviderSection from "../components/admin/SsoProviderSection.jsx";

export default function AdminSettingsSso() {
  return (
    <div className="admin-shell">
      <h2>Single Sign-On</h2>
      <SsoProviderSection />
    </div>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import PublicMap from "./pages/PublicMap.jsx";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import Login from "./pages/Login.jsx";
import Setup from "./pages/Setup.jsx";
import AdminHome from "./pages/AdminHome.jsx";
import AdminPartners from "./pages/AdminPartners.jsx";
import AdminPartnerForm from "./pages/AdminPartnerForm.jsx";
import AdminPartnerDetail from "./pages/AdminPartnerDetail.jsx";
import AdminBooklet from "./pages/AdminBooklet.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import AdminUserForm from "./pages/AdminUserForm.jsx";
import AccountSettings from "./pages/AccountSettings.jsx";
import AdminSettingsAbout from "./pages/AdminSettingsAbout.jsx";
import AdminSettingsBranding from "./pages/AdminSettingsBranding.jsx";
import AdminSettingsFeatures from "./pages/AdminSettingsFeatures.jsx";
import AdminSettingsSso from "./pages/AdminSettingsSso.jsx";
import AdminMonthlySupport from "./pages/AdminMonthlySupport.jsx";
import AdminOneTimeNeeds from "./pages/AdminOneTimeNeeds.jsx";
import AdminPrayerRequests from "./pages/AdminPrayerRequests.jsx";
import AdminTripHistory from "./pages/AdminTripHistory.jsx";
import AdminTripOpportunities from "./pages/AdminTripOpportunities.jsx";
import AdminNewsletters from "./pages/AdminNewsletters.jsx";
import AdminDocuments from "./pages/AdminDocuments.jsx";
import RequireAdminAuth from "./components/RequireAdminAuth.jsx";
import RequirePublicSite from "./components/RequirePublicSite.jsx";
import RequireAdminFeature from "./components/RequireAdminFeature.jsx";
import AdminLayout from "./components/admin/AdminLayout.jsx";
import { SettingsProvider } from "./context/SettingsContext.jsx";
import "./index.css";

// Old /admin/missionaries/:id and /admin/organizations/:id URLs point at the
// same record under /admin/partners/:id -- the merge kept every id, so this
// is a straight path swap rather than a lookup.
function LegacyPartnerRedirect({ edit = false }) {
  const { id } = useParams();
  return <Navigate to={`/admin/partners/${id}${edit ? "/edit" : ""}`} replace />;
}

// Same for the public site, where the kind used to be in the path.
function LegacyPublicPartnerRedirect() {
  const { id } = useParams();
  return <Navigate to={`/partners/${id}`} replace />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* Public site */}
          <Route path="/" element={<RequirePublicSite feature="publicDirectory"><PublicDirectory /></RequirePublicSite>} />
          <Route path="/map" element={<RequirePublicSite feature="publicMap"><PublicMap /></RequirePublicSite>} />
          <Route
            path="/partners/:id"
            element={
              <RequirePublicSite feature={["publicDirectory", "publicMap"]}>
                <PublicPartnerDetail />
              </RequirePublicSite>
            }
          />
          <Route path="/partners/:type/:id" element={<LegacyPublicPartnerRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />

          {/* Admin (protected) — one shared sidebar layout for every
              sub-route below, including detail/edit forms. Role-specific
              routes (users, settings) add their own extra RequireAdminAuth
              on top of the outer any-logged-in-role check. */}
          <Route
            path="/admin"
            element={
              <RequireAdminAuth>
                <AdminLayout />
              </RequireAdminAuth>
            }
          >
            <Route index element={<AdminHome />} />
            <Route path="partners" element={<AdminPartners />} />
            <Route path="partners/new" element={<AdminPartnerForm />} />
            <Route path="partners/:id" element={<AdminPartnerDetail />} />
            <Route path="partners/:id/edit" element={<AdminPartnerForm />} />
            {/* Missionaries and organizations merged into one Partner
                resource in v2.0.0. These keep old bookmarks and any links
                sent round in email working -- the ids didn't change. */}
            <Route path="missionaries/new" element={<Navigate to="/admin/partners/new?kind=missionary" replace />} />
            <Route path="organizations/new" element={<Navigate to="/admin/partners/new?kind=organization" replace />} />
            <Route path="missionaries/:id" element={<LegacyPartnerRedirect />} />
            <Route path="missionaries/:id/edit" element={<LegacyPartnerRedirect edit />} />
            <Route path="organizations/:id" element={<LegacyPartnerRedirect />} />
            <Route path="organizations/:id/edit" element={<LegacyPartnerRedirect edit />} />
            <Route path="booklet" element={<RequireAdminFeature feature="booklet"><AdminBooklet /></RequireAdminFeature>} />
            <Route
              path="support/monthly"
              element={<RequireAdminFeature feature="monthlySupport"><AdminMonthlySupport /></RequireAdminFeature>}
            />
            <Route
              path="support/needs"
              element={<RequireAdminFeature feature="oneTimeNeeds"><AdminOneTimeNeeds /></RequireAdminFeature>}
            />
            <Route
              path="prayer-requests"
              element={<RequireAdminFeature feature="prayerRequests"><AdminPrayerRequests /></RequireAdminFeature>}
            />
            <Route path="trips" element={<RequireAdminFeature feature="trips"><AdminTripHistory /></RequireAdminFeature>} />
            <Route
              path="trips/opportunities"
              element={<RequireAdminFeature feature="trips"><AdminTripOpportunities /></RequireAdminFeature>}
            />
            <Route path="newsletters" element={<AdminNewsletters />} />
            <Route path="documents" element={<AdminDocuments />} />
            <Route path="account" element={<AccountSettings />} />
            {/* Site Administration -- one admin-only guard on the whole
                sub-tree instead of repeating RequireAdminAuth per leaf
                route. No shared visual layout here (no wrapper element,
                just Outlet) -- unlike the rest of /admin/*, these pages are
                reached via the sidebar's own expandable "Site
                Administration" group (see AdminSidebar.jsx), not a
                same-page tab bar, so each page owns its own heading. */}
            <Route path="settings" element={<RequireAdminAuth role="admin"><Outlet /></RequireAdminAuth>}>
              <Route index element={<Navigate to="about" replace />} />
              <Route path="about" element={<AdminSettingsAbout />} />
              <Route path="branding" element={<AdminSettingsBranding />} />
              <Route path="features" element={<AdminSettingsFeatures />} />
              <Route path="sso" element={<AdminSettingsSso />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/new" element={<AdminUserForm />} />
              <Route path="users/:id" element={<AdminUserForm />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  </React.StrictMode>
);

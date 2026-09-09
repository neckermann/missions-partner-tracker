import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PublicMap from "./pages/PublicMap.jsx";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import Login from "./pages/Login.jsx";
import Setup from "./pages/Setup.jsx";
import AdminHome from "./pages/AdminHome.jsx";
import AdminPartners from "./pages/AdminPartners.jsx";
import AdminMissionaryForm from "./pages/AdminMissionaryForm.jsx";
import AdminMissionaryDetail from "./pages/AdminMissionaryDetail.jsx";
import AdminBooklet from "./pages/AdminBooklet.jsx";
import AdminOrganizationForm from "./pages/AdminOrganizationForm.jsx";
import AdminOrganizationDetail from "./pages/AdminOrganizationDetail.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import AdminUserForm from "./pages/AdminUserForm.jsx";
import AccountSettings from "./pages/AccountSettings.jsx";
import AdminSettingsGeneral from "./pages/AdminSettingsGeneral.jsx";
import AdminSettingsBranding from "./pages/AdminSettingsBranding.jsx";
import AdminSettingsFeatures from "./pages/AdminSettingsFeatures.jsx";
import AdminSettingsSso from "./pages/AdminSettingsSso.jsx";
import AdminSettingsLayout from "./components/admin/AdminSettingsLayout.jsx";
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* Public site */}
          <Route path="/" element={<RequirePublicSite feature="publicDirectory"><PublicDirectory /></RequirePublicSite>} />
          <Route path="/map" element={<RequirePublicSite feature="publicMap"><PublicMap /></RequirePublicSite>} />
          <Route
            path="/partners/:type/:id"
            element={
              <RequirePublicSite feature={["publicDirectory", "publicMap"]}>
                <PublicPartnerDetail />
              </RequirePublicSite>
            }
          />
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
            <Route path="missionaries/new" element={<AdminMissionaryForm />} />
            <Route path="missionaries/:id" element={<AdminMissionaryDetail />} />
            <Route path="missionaries/:id/edit" element={<AdminMissionaryForm />} />
            <Route path="organizations/new" element={<AdminOrganizationForm />} />
            <Route path="organizations/:id" element={<AdminOrganizationDetail />} />
            <Route path="organizations/:id/edit" element={<AdminOrganizationForm />} />
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
            {/* Church Settings -- one admin-only guard on the whole
                sub-tree (AdminSettingsLayout's tabs, including User
                Management) instead of repeating RequireAdminAuth per leaf
                route, now that Users lives here too instead of its own
                top-level nav entry. */}
            <Route
              path="settings"
              element={
                <RequireAdminAuth role="admin">
                  <AdminSettingsLayout />
                </RequireAdminAuth>
              }
            >
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<AdminSettingsGeneral />} />
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

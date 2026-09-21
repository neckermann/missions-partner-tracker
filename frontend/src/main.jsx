import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import Login from "./pages/Login.jsx";
import Setup from "./pages/Setup.jsx";
import RequireAdminAuth from "./components/RequireAdminAuth.jsx";
import RequirePublicSite from "./components/RequirePublicSite.jsx";
import RequireAdminFeature from "./components/RequireAdminFeature.jsx";
import { SettingsProvider } from "./context/SettingsContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";

// Everything below is split out of the entry bundle, for two reasons.
//
// The first is privacy: until this split, a single bundle held every admin
// page, so someone who only ever looked at the public directory still
// downloaded the whole admin surface -- the printed-booklet templates, the
// settings screens, all of it. No partner data leaked (every admin endpoint
// is behind requireAuth, and the public API runs through the masking
// serializer), but handing an anonymous visitor a readable map of the admin
// app is worth avoiding on its own. e2e/public-bundle.spec.js asserts the
// public entry point stays clean.
//
// The second is weight: the map pulls in Leaflet and the booklet pulls in
// paged.js plus a 980-line print stylesheet, none of which a visitor
// browsing the directory should pay for.
const PublicMap = lazy(() => import("./pages/PublicMap.jsx"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout.jsx"));
const AdminHome = lazy(() => import("./pages/AdminHome.jsx"));
const AdminPartners = lazy(() => import("./pages/AdminPartners.jsx"));
const AdminPartnerForm = lazy(() => import("./pages/AdminPartnerForm.jsx"));
const AdminPartnerDetail = lazy(() => import("./pages/AdminPartnerDetail.jsx"));
const AdminBooklet = lazy(() => import("./pages/AdminBooklet.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const AdminUserForm = lazy(() => import("./pages/AdminUserForm.jsx"));
const AccountSettings = lazy(() => import("./pages/AccountSettings.jsx"));
const AdminSettingsAbout = lazy(() => import("./pages/AdminSettingsAbout.jsx"));
const AdminSettingsBranding = lazy(() => import("./pages/AdminSettingsBranding.jsx"));
const AdminSettingsFeatures = lazy(() => import("./pages/AdminSettingsFeatures.jsx"));
const AdminMonthlySupport = lazy(() => import("./pages/AdminMonthlySupport.jsx"));
const AdminOneTimeNeeds = lazy(() => import("./pages/AdminOneTimeNeeds.jsx"));
const AdminPrayerRequests = lazy(() => import("./pages/AdminPrayerRequests.jsx"));
const AdminTripHistory = lazy(() => import("./pages/AdminTripHistory.jsx"));
const AdminTripOpportunities = lazy(() => import("./pages/AdminTripOpportunities.jsx"));
const AdminNewsletters = lazy(() => import("./pages/AdminNewsletters.jsx"));
const AdminDocuments = lazy(() => import("./pages/AdminDocuments.jsx"));

// Chunks are served same-origin from this app, so the gap is a network hop
// on a local connection, not a spinner anyone will study.
function RouteFallback() {
  return <p style={{ padding: "2rem" }}>Loading...</p>;
}

// Old /admin/missionaries/:id and /admin/organizations/:id URLs point at the
// same record under /admin/partners/:id -- the merge kept every id, so this
// is a straight path swap rather than a lookup. The old `/edit` paths land
// on the same place: the partner page is the editor now, so there is
// nowhere separate to send them.
function LegacyPartnerRedirect() {
  const { id } = useParams();
  return <Navigate to={`/admin/partners/${id}`} replace />;
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
        {/* Outermost net: catches a render error on any page, and a failed
            lazy-chunk import after a deploy -- Suspense covers the pending
            state, not the failure. */}
        <ErrorBoundary homeHref="/" homeLabel="the home page">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public site */}
              <Route
                path="/"
                element={
                  <RequirePublicSite feature="publicDirectory">
                    <PublicDirectory />
                  </RequirePublicSite>
                }
              />
              <Route
                path="/map"
                element={
                  <RequirePublicSite feature="publicMap">
                    <PublicMap />
                  </RequirePublicSite>
                }
              />
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
                {/* The partner page edits itself section by section, so there is
                no separate edit form any more -- old links land on it. */}
                <Route path="partners/:id/edit" element={<LegacyPartnerRedirect />} />
                {/* Missionaries and organizations merged into one Partner
                resource in v2.0.0. These keep old bookmarks and any links
                sent round in email working -- the ids didn't change. */}
                <Route
                  path="missionaries/new"
                  element={<Navigate to="/admin/partners/new?kind=missionary" replace />}
                />
                <Route
                  path="organizations/new"
                  element={<Navigate to="/admin/partners/new?kind=organization" replace />}
                />
                <Route path="missionaries/:id" element={<LegacyPartnerRedirect />} />
                <Route path="missionaries/:id/edit" element={<LegacyPartnerRedirect />} />
                <Route path="organizations/:id" element={<LegacyPartnerRedirect />} />
                <Route path="organizations/:id/edit" element={<LegacyPartnerRedirect />} />
                <Route
                  path="booklet"
                  element={
                    <RequireAdminFeature feature="booklet">
                      <AdminBooklet />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="support/monthly"
                  element={
                    <RequireAdminFeature feature="monthlySupport">
                      <AdminMonthlySupport />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="support/needs"
                  element={
                    <RequireAdminFeature feature="oneTimeNeeds">
                      <AdminOneTimeNeeds />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="prayer-requests"
                  element={
                    <RequireAdminFeature feature="prayerRequests">
                      <AdminPrayerRequests />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripHistory />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/opportunities"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripOpportunities />
                    </RequireAdminFeature>
                  }
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
                <Route
                  path="settings"
                  element={
                    <RequireAdminAuth requiredRole="admin">
                      <Outlet />
                    </RequireAdminAuth>
                  }
                >
                  <Route index element={<Navigate to="about" replace />} />
                  <Route path="about" element={<AdminSettingsAbout />} />
                  <Route path="branding" element={<AdminSettingsBranding />} />
                  <Route path="features" element={<AdminSettingsFeatures />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="users/new" element={<AdminUserForm />} />
                  <Route path="users/:id" element={<AdminUserForm />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </SettingsProvider>
  </React.StrictMode>
);

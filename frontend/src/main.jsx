import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import PublicSubscribe from "./pages/PublicSubscribe.jsx";
import PublicTripOpportunities from "./pages/PublicTripOpportunities.jsx";
import PublicTripApplication from "./pages/PublicTripApplication.jsx";
import PublicTripParticipant from "./pages/PublicTripParticipant.jsx";
import PublicTripAccessRecovery from "./pages/PublicTripAccessRecovery.jsx";
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
const AdminReports = lazy(() => import("./pages/AdminReports.jsx"));
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
const AdminSettingsGroupMe = lazy(() => import("./pages/AdminSettingsGroupMe.jsx"));
const AdminSettingsWhatsApp = lazy(() => import("./pages/AdminSettingsWhatsApp.jsx"));
const AdminSettingsJoshuaProject = lazy(() => import("./pages/AdminSettingsJoshuaProject.jsx"));
const AdminSettingsAiExtraction = lazy(() => import("./pages/AdminSettingsAiExtraction.jsx"));
const AdminSettingsEmail = lazy(() => import("./pages/AdminSettingsEmail.jsx"));
const AdminInboundEmailQueue = lazy(() => import("./pages/AdminInboundEmailQueue.jsx"));
const AdminPendingDispatches = lazy(() => import("./pages/AdminPendingDispatches.jsx"));
const AdminDispatchSettings = lazy(() => import("./pages/AdminDispatchSettings.jsx"));
const AdminSettingsBackups = lazy(() => import("./pages/AdminSettingsBackups.jsx"));
const AdminSystemInfo = lazy(() => import("./pages/AdminSystemInfo.jsx"));
const AdminMonthlySupport = lazy(() => import("./pages/AdminMonthlySupport.jsx"));
const AdminOneTimeNeeds = lazy(() => import("./pages/AdminOneTimeNeeds.jsx"));
const AdminPrayerRequests = lazy(() => import("./pages/AdminPrayerRequests.jsx"));
const AdminTrips = lazy(() => import("./pages/AdminTrips.jsx"));
const AdminTripPlanning = lazy(() => import("./pages/AdminTripPlanning.jsx"));
const AdminTripDetail = lazy(() => import("./pages/AdminTripDetail.jsx"));
const AdminTripDashboard = lazy(() => import("./pages/AdminTripDashboard.jsx"));
const AdminSettingsTrips = lazy(() => import("./pages/AdminSettingsTrips.jsx"));
const AdminPartnerFiles = lazy(() => import("./pages/AdminPartnerFiles.jsx"));

// Chunks are served same-origin from this app, so the gap is a network hop
// on a local connection, not a spinner anyone will study.
function RouteFallback() {
  return <p style={{ padding: "2rem" }}>Loading...</p>;
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
              <Route
                path="/subscribe"
                element={
                  <RequirePublicSite feature="publicPrayerDigest">
                    <PublicSubscribe />
                  </RequirePublicSite>
                }
              />
              <Route
                path="/trips"
                element={
                  <RequirePublicSite feature="publicTripDiscovery">
                    <PublicTripOpportunities />
                  </RequirePublicSite>
                }
              />
              {/* Trips (#252) public application/support-raising/recovery pages
              are NOT wrapped in RequirePublicSite -- unlike /trips (the
              broadly-discoverable listing), these are reached only via a
              direct link (plain, or the private applicationShareToken/
              shareToken/access-token links), and the backend route itself
              is what enforces every eligibility rule (status/isPublic/
              publicTripDiscovery/restricted-partner) per trip -- there's no
              single church-wide flag that correctly gates all of them at
              once the way RequirePublicSite's single-feature check assumes. */}
              <Route path="/apply/:id" element={<PublicTripApplication />} />
              <Route path="/apply/by-token/:token" element={<PublicTripApplication />} />
              <Route path="/trip-support-raising/:shareToken" element={<PublicTripParticipant />} />
              <Route path="/my-trip" element={<PublicTripParticipant />} />
              <Route path="/trip-access-recovery" element={<PublicTripAccessRecovery />} />
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
                <Route
                  path="booklet"
                  element={
                    <RequireAdminFeature feature="booklet">
                      <AdminBooklet />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <RequireAdminFeature feature="reports">
                      <AdminReports />
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
                      <AdminTrips />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/planning"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripPlanning />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/dashboard"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripDashboard />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/:id"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripDetail />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="partner-files"
                  element={
                    <RequireAdminFeature feature="partnerFiles">
                      <AdminPartnerFiles />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="inbound-email"
                  element={
                    <RequireAdminFeature feature="inboundEmail">
                      <AdminInboundEmailQueue />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="pending-dispatches"
                  element={
                    <RequireAdminFeature feature={["groupme", "whatsapp", "outboundEmail"]}>
                      <AdminPendingDispatches />
                    </RequireAdminFeature>
                  }
                />
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
                  <Route path="groupme" element={<AdminSettingsGroupMe />} />
                  <Route
                    path="whatsapp"
                    element={
                      <RequireAdminFeature feature="whatsapp">
                        <AdminSettingsWhatsApp />
                      </RequireAdminFeature>
                    }
                  />
                  <Route path="joshua-project" element={<AdminSettingsJoshuaProject />} />
                  <Route path="ai-extraction" element={<AdminSettingsAiExtraction />} />
                  <Route path="email" element={<AdminSettingsEmail />} />
                  <Route
                    path="trips"
                    element={
                      <RequireAdminFeature feature="trips">
                        <AdminSettingsTrips />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="dispatches"
                    element={
                      <RequireAdminFeature feature={["groupme", "whatsapp", "outboundEmail"]}>
                        <AdminDispatchSettings />
                      </RequireAdminFeature>
                    }
                  />
                  <Route path="backups" element={<AdminSettingsBackups />} />
                  <Route path="system-info" element={<AdminSystemInfo />} />
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

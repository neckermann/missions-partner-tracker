import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import PublicSubscribe from "./pages/PublicSubscribe.jsx";
import PublicTripOpportunities from "./pages/PublicTripOpportunities.jsx";
import PublicTripApplication from "./pages/PublicTripApplication.jsx";
import PublicTripParticipant from "./pages/PublicTripParticipant.jsx";
import PublicTripAccessRecovery from "./pages/PublicTripAccessRecovery.jsx";
import NotFound from "./pages/NotFound.jsx";
import PublicSurvey from "./pages/PublicSurvey.jsx";
import Login from "./pages/Login.jsx";
import SignInLink from "./pages/SignInLink.jsx";
import Setup from "./pages/Setup.jsx";
import SetPassword from "./pages/SetPassword.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import RequireAdminAuth from "./components/RequireAdminAuth.jsx";
import RequirePublicSite from "./components/RequirePublicSite.jsx";
import RequireAdminFeature from "./components/RequireAdminFeature.jsx";
import { SettingsProvider } from "./context/SettingsContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";

// Everything below is split out of the entry bundle. Privacy: a visitor to the public directory
// shouldn't download a readable map of the admin app (no data leaks, since admin endpoints require
// auth and the public API is masked); e2e/public-bundle.spec.js asserts the public entry stays
// clean. Weight: the map (Leaflet) and booklet (paged.js, print CSS) are not paid for by visitors.
const AdminReports = lazy(() => import("./pages/AdminReports.jsx"));
const AdminReport = lazy(() => import("./pages/AdminReport.jsx"));
const PublicMap = lazy(() => import("./pages/PublicMap.jsx"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout.jsx"));
const AdminHome = lazy(() => import("./pages/AdminHome.jsx"));
const AdminPartners = lazy(() => import("./pages/AdminPartners.jsx"));
const AdminPartnerForm = lazy(() => import("./pages/AdminPartnerForm.jsx"));
const AdminPartnerDetail = lazy(() => import("./pages/AdminPartnerDetail.jsx"));
const AdminBooklet = lazy(() => import("./pages/AdminBooklet.jsx"));
const AdminPrayerSheet = lazy(() => import("./pages/AdminPrayerSheet.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const AdminUserForm = lazy(() => import("./pages/AdminUserForm.jsx"));
const AccountSettings = lazy(() => import("./pages/AccountSettings.jsx"));
const AdminSettingsHome = lazy(() => import("./pages/AdminSettingsHome.jsx"));
const AdminSettingsAbout = lazy(() => import("./pages/AdminSettingsAbout.jsx"));
const AdminSettingsPrivacy = lazy(() => import("./pages/AdminSettingsPrivacy.jsx"));
const AdminPublicSiteChoice = lazy(() => import("./pages/AdminPublicSiteChoice.jsx"));
const AdminAddAdministrator = lazy(() => import("./pages/AdminAddAdministrator.jsx"));
const AdminSettingsFeatures = lazy(() => import("./pages/AdminSettingsFeatures.jsx"));
const AdminSettingsGroupMe = lazy(() => import("./pages/AdminSettingsGroupMe.jsx"));
const AdminSettingsWhatsApp = lazy(() => import("./pages/AdminSettingsWhatsApp.jsx"));
const AdminSettingsIntegrations = lazy(() => import("./pages/AdminSettingsIntegrations.jsx"));
const AdminSettingsEmail = lazy(() => import("./pages/AdminSettingsEmail.jsx"));
const AdminInboundEmailQueue = lazy(() => import("./pages/AdminInboundEmailQueue.jsx"));
const AdminPendingDispatches = lazy(() => import("./pages/AdminPendingDispatches.jsx"));
const AdminDispatchSettings = lazy(() => import("./pages/AdminDispatchSettings.jsx"));
const AdminSystemInfo = lazy(() => import("./pages/AdminSystemInfo.jsx"));
const AdminMonthlySupport = lazy(() => import("./pages/AdminMonthlySupport.jsx"));
const AdminOneTimeNeeds = lazy(() => import("./pages/AdminOneTimeNeeds.jsx"));
const AdminPrayerRequests = lazy(() => import("./pages/AdminPrayerRequests.jsx"));
const AdminTrips = lazy(() => import("./pages/AdminTrips.jsx"));
const TripDetailLayout = lazy(() => import("./components/admin/TripDetailLayout.jsx"));
const AdminTripOverview = lazy(() => import("./pages/AdminTripOverview.jsx"));
const AdminTripTeam = lazy(() => import("./pages/AdminTripTeam.jsx"));
const AdminTripMeetings = lazy(() => import("./pages/AdminTripMeetings.jsx"));
const AdminTripRequirements = lazy(() => import("./pages/AdminTripRequirements.jsx"));
const AdminTripFinancial = lazy(() => import("./pages/AdminTripFinancial.jsx"));
const AdminTripFlights = lazy(() => import("./pages/AdminTripFlights.jsx"));
const AdminTripParticipantDetail = lazy(() => import("./pages/AdminTripParticipantDetail.jsx"));
const AdminTripApplicationDetail = lazy(() => import("./pages/AdminTripApplicationDetail.jsx"));
const AdminSettingsTrips = lazy(() => import("./pages/AdminSettingsTrips.jsx"));
const AdminSettingsPartnerCare = lazy(() => import("./pages/AdminSettingsPartnerCare.jsx"));
const AdminTripWrapUp = lazy(() => import("./pages/AdminTripWrapUp.jsx"));
const AdminSettingsSupportPreferences = lazy(() => import("./pages/AdminSettingsSupportPreferences.jsx"));
const AdminSettingsSupportPreferencesPrint = lazy(
  () => import("./pages/AdminSettingsSupportPreferencesPrint.jsx")
);
const AdminContactLog = lazy(() => import("./pages/AdminContactLog.jsx"));
const AdminSurveyUpdates = lazy(() => import("./pages/AdminSurveyUpdates.jsx"));
const AdminSettingsSurveys = lazy(() => import("./pages/AdminSettingsSurveys.jsx"));
const AdminSettingsSurveyDetail = lazy(() => import("./pages/AdminSettingsSurveyDetail.jsx"));
const AdminSettingsAudit = lazy(() => import("./pages/AdminSettingsAudit.jsx"));
const AdminPartnerFiles = lazy(() => import("./pages/AdminPartnerFiles.jsx"));

// Chunks are same-origin, so the gap is a local network hop, not a spinner anyone will study.
function RouteFallback() {
  return <p style={{ padding: "2rem" }}>Loading...</p>;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        {/* Outermost net: a render error on any page, or a failed lazy-chunk import after a deploy. */}
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
              {/* Trips public application/support-raising/recovery pages are not wrapped in RequirePublicSite:
                            they are reached by direct link and the backend route enforces each eligibility rule per
                            trip; no single church-wide flag gates them all. */}
              <Route path="/apply/:id" element={<PublicTripApplication />} />
              <Route path="/apply/by-token/:token" element={<PublicTripApplication />} />
              <Route path="/trip-support-raising/:shareToken" element={<PublicTripParticipant />} />
              <Route path="/my-trip" element={<PublicTripParticipant />} />
              <Route path="/trip-access-recovery" element={<PublicTripAccessRecovery />} />
              <Route path="/survey/:token" element={<PublicSurvey />} />
              <Route path="/login" element={<Login />} />
              <Route path="/login/link" element={<SignInLink />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/set-password" element={<SetPassword />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />

              {/* Admin (protected): one shared sidebar layout; role-specific routes add their own
                            RequireAdminAuth on top of the outer any-logged-in-role check. */}
              <Route
                path="/admin"
                element={
                  <RequireAdminAuth>
                    <AdminLayout />
                  </RequireAdminAuth>
                }
              >
                <Route index element={<AdminHome />} />
                <Route path="public-site" element={<AdminPublicSiteChoice />} />
                <Route path="add-administrator" element={<AdminAddAdministrator />} />
                <Route path="partners" element={<AdminPartners />} />
                <Route path="partners/new" element={<AdminPartnerForm />} />
                <Route path="partners/:id" element={<AdminPartnerDetail />} />
                <Route
                  path="prayer-sheet"
                  element={
                    <RequireAdminFeature feature="prayerRequests">
                      <AdminPrayerSheet />
                    </RequireAdminFeature>
                  }
                />
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
                  path="reports/:reportId"
                  element={
                    <RequireAdminFeature feature="reports">
                      <AdminReport />
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
                      <AdminTrips />
                    </RequireAdminFeature>
                  }
                />
                {/* Static segment: React Router ranks it ahead of trips/:id regardless of order. */}
                <Route
                  path="trips/contributions"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTrips />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/:id"
                  element={
                    <RequireAdminFeature feature="trips">
                      <TripDetailLayout />
                    </RequireAdminFeature>
                  }
                >
                  <Route index element={<AdminTripOverview />} />
                  <Route path="team" element={<AdminTripTeam />} />
                  <Route path="meetings" element={<AdminTripMeetings />} />
                  <Route path="requirements" element={<AdminTripRequirements />} />
                  <Route path="financial" element={<AdminTripFinancial />} />
                  <Route path="flights" element={<AdminTripFlights />} />
                  <Route path="wrap-up" element={<AdminTripWrapUp />} />
                </Route>
                <Route
                  path="trips/:tripId/participants/:participantId"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripParticipantDetail />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="trips/:tripId/applications/:applicationId"
                  element={
                    <RequireAdminFeature feature="trips">
                      <AdminTripApplicationDetail />
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
                  path="contact-log"
                  element={
                    <RequireAdminFeature feature="contactLog">
                      <AdminContactLog />
                    </RequireAdminFeature>
                  }
                />
                <Route
                  path="survey-updates"
                  element={
                    <RequireAdminFeature feature="surveys">
                      <AdminSurveyUpdates />
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
                {/* Settings: one admin-only guard on the whole sub-tree, no shared layout (reached via the
                                sidebar's Settings group, so each page owns its heading). */}
                <Route
                  path="settings"
                  element={
                    <RequireAdminAuth requiredRole="admin">
                      <Outlet />
                    </RequireAdminAuth>
                  }
                >
                  <Route index element={<AdminSettingsHome />} />
                  <Route path="about" element={<AdminSettingsAbout />} />
                  <Route path="privacy" element={<AdminSettingsPrivacy />} />
                  <Route path="features" element={<AdminSettingsFeatures />} />
                  <Route
                    path="groupme"
                    element={
                      <RequireAdminFeature feature="groupme">
                        <AdminSettingsGroupMe />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="whatsapp"
                    element={
                      <RequireAdminFeature feature="whatsapp">
                        <AdminSettingsWhatsApp />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="integrations"
                    element={
                      <RequireAdminFeature feature={["aiExtraction", "joshuaProject"]}>
                        <AdminSettingsIntegrations />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="email"
                    element={
                      <RequireAdminFeature feature={["outboundEmail", "inboundEmail"]}>
                        <AdminSettingsEmail />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="trips"
                    element={
                      <RequireAdminFeature feature="trips">
                        <AdminSettingsTrips />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="partner-care"
                    element={
                      <RequireAdminFeature feature={["careTeam", "keyDates", "contactLog"]}>
                        <AdminSettingsPartnerCare />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="support-preferences"
                    element={
                      <RequireAdminFeature feature="supportPreferences">
                        <AdminSettingsSupportPreferences />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="support-preferences/print"
                    element={
                      <RequireAdminFeature feature="supportPreferences">
                        <AdminSettingsSupportPreferencesPrint />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="surveys"
                    element={
                      <RequireAdminFeature feature="surveys">
                        <AdminSettingsSurveys />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="surveys/:id"
                    element={
                      <RequireAdminFeature feature="surveys">
                        <AdminSettingsSurveyDetail />
                      </RequireAdminFeature>
                    }
                  />
                  <Route
                    path="audit"
                    element={
                      <RequireAdminFeature feature="auditTrail">
                        <AdminSettingsAudit />
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
                  <Route path="system-info" element={<AdminSystemInfo />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="users/new" element={<AdminUserForm />} />
                </Route>
                {/* An unknown address under /admin: a message inside the shell, not a blank page. */}
                <Route path="*" element={<NotFound inAdmin />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </SettingsProvider>
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PublicMap from "./pages/PublicMap.jsx";
import PublicDirectory from "./pages/PublicDirectory.jsx";
import PublicPartnerDetail from "./pages/PublicPartnerDetail.jsx";
import Login from "./pages/Login.jsx";
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
import AdminMonthlySupport from "./pages/AdminMonthlySupport.jsx";
import AdminOneTimeNeeds from "./pages/AdminOneTimeNeeds.jsx";
import AdminTripHistory from "./pages/AdminTripHistory.jsx";
import AdminTripOpportunities from "./pages/AdminTripOpportunities.jsx";
import AdminNewsletters from "./pages/AdminNewsletters.jsx";
import AdminChurchSettings from "./pages/AdminChurchSettings.jsx";
import RequireAdminAuth from "./components/RequireAdminAuth.jsx";
import AdminLayout from "./components/admin/AdminLayout.jsx";
import { SettingsProvider } from "./context/SettingsContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          {/* Public site */}
          <Route path="/" element={<PublicDirectory />} />
          <Route path="/map" element={<PublicMap />} />
          <Route path="/partners/:type/:id" element={<PublicPartnerDetail />} />
          <Route path="/login" element={<Login />} />

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
            <Route path="booklet" element={<AdminBooklet />} />
            <Route path="support/monthly" element={<AdminMonthlySupport />} />
            <Route path="support/needs" element={<AdminOneTimeNeeds />} />
            <Route path="trips" element={<AdminTripHistory />} />
            <Route path="trips/opportunities" element={<AdminTripOpportunities />} />
            <Route path="newsletters" element={<AdminNewsletters />} />
            <Route path="account" element={<AccountSettings />} />
            <Route
              path="users"
              element={
                <RequireAdminAuth role="admin">
                  <AdminUsers />
                </RequireAdminAuth>
              }
            />
            <Route
              path="users/new"
              element={
                <RequireAdminAuth role="admin">
                  <AdminUserForm />
                </RequireAdminAuth>
              }
            />
            <Route
              path="users/:id"
              element={
                <RequireAdminAuth role="admin">
                  <AdminUserForm />
                </RequireAdminAuth>
              }
            />
            <Route
              path="settings"
              element={
                <RequireAdminAuth role="admin">
                  <AdminChurchSettings />
                </RequireAdminAuth>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  </React.StrictMode>
);

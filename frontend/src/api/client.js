import axios from "axios";

// The backend serves this frontend directly (see backend/src/server.js),
// so "/api" always resolves same-origin — in local dev, Vite's proxy
// forwards it to the backend dev server (see vite.config.js); in
// production, Express serves both from the same origin.
export const api = axios.create({
  baseURL: "/api",
});

// No token to attach here — the session lives in an httpOnly cookie
// (set by the backend on login; see backend/src/utils/jwt.js), which the
// browser sends automatically on every same-origin request. Client-side
// JS never sees the token at all, which is the point: an XSS bug can't
// steal a credential it can't read.

// Missionaries and organizations are one resource now, distinguished by
// `kind` — pass { kind: "missionary" } to narrow. See the Partner model
// comment in backend/prisma/schema.prisma for why they merged.
export async function fetchPublicPartners(params = {}) {
  const { data } = await api.get("/public/partners", { params });
  return data;
}

export async function fetchPublicPartner(id) {
  const { data } = await api.get(`/public/partners/${id}`);
  return data;
}

export async function fetchCountryInfo(countryCode) {
  const { data } = await api.get(`/public/country-info/${countryCode}`);
  return data;
}

// --- Partners (admin) ---
//
// fetchPartners returns summary rows only — enough to render a list, not a
// partner's whole history. fetchPartner returns the record plus its
// one-per-partner sub-records (addresses, family, sending parties,
// furloughs, visits, photos); the history collections each come from their
// own endpoint below, so a section fetches only what it displays.

export async function fetchPartners(params = {}) {
  const { data } = await api.get("/partners", { params });
  return data;
}

export async function fetchPartner(id) {
  const { data } = await api.get(`/partners/${id}`);
  return data;
}

export async function createPartner(payload) {
  const { data } = await api.post("/partners", payload);
  return data;
}

// A partial update: only the keys you send are touched, so a section can
// save just its own fields. Collection arrays (trips, support entries,
// needs, prayer requests, newsletters, documents) are ignored if sent —
// each has its own endpoint.
export async function updatePartner(id, payload) {
  const { data } = await api.put(`/partners/${id}`, payload);
  return data;
}

export async function deletePartner(id) {
  await api.delete(`/partners/${id}`);
}

export async function archivePartner(id) {
  const { data } = await api.post(`/partners/${id}/archive`);
  return data;
}

export async function unarchivePartner(id) {
  const { data } = await api.post(`/partners/${id}/unarchive`);
  return data;
}

export async function uploadPartnerImage(id, file, receivedDate) {
  const formData = new FormData();
  formData.append("image", file);
  if (receivedDate) formData.append("receivedDate", receivedDate);
  const { data } = await api.post(`/partners/${id}/image`, formData);
  return data;
}

export async function deletePartnerPhoto(id, photoId) {
  await api.delete(`/partners/${id}/photos/${photoId}`);
}

export async function fetchChurchSettings() {
  const { data } = await api.get("/settings");
  return data;
}

// Backs the "an update is available" banner in AdminLayout.jsx. Admin-role
// only, so a non-admin staff account just won't see the banner rather than
// erroring — see UpdateBanner.jsx.
export async function fetchVersionCheck() {
  const { data } = await api.get("/version-check");
  return data;
}

// Backs the database-backup reminder in AdminLayout.jsx. Admin-role only,
// same reasoning as fetchVersionCheck above -- see BackupReminder.jsx.
export async function fetchBackupCheck() {
  const { data } = await api.get("/backup-check");
  return data;
}

export async function updateChurchSettings(payload) {
  const { data } = await api.put("/settings", payload);
  return data;
}

export async function uploadChurchLogo(file) {
  const formData = new FormData();
  formData.append("image", file);
  const { data } = await api.post("/settings/logo", formData);
  return data;
}

export async function fetchPublicSettings() {
  const { data } = await api.get("/public/settings");
  return data;
}

// --- SSO (Single Sign-On) ---

// Public — powers the login page's dynamic "Sign in with ..." buttons.
export async function fetchSsoProviders() {
  const { data } = await api.get("/auth/sso/providers");
  return data;
}

// Admin (Church Settings) — full CRUD, includes disabled providers.
export async function fetchSsoProviderList() {
  const { data } = await api.get("/sso-providers");
  return data;
}

export async function createSsoProvider(payload) {
  const { data } = await api.post("/sso-providers", payload);
  return data;
}

export async function updateSsoProvider(id, payload) {
  const { data } = await api.put(`/sso-providers/${id}`, payload);
  return data;
}

export async function deleteSsoProvider(id) {
  await api.delete(`/sso-providers/${id}`);
}

// Every collection fetcher below takes an optional { partnerId } to scope
// it to one partner. The consolidated admin pages call them bare; the
// sections on a partner's page pass the id. Either way it's one query,
// rather than loading every partner and filtering in the browser.
export async function fetchSupportNeeds(params = {}) {
  const { data } = await api.get("/support-needs", { params });
  return data;
}

export async function createSupportNeed(payload) {
  const { data } = await api.post("/support-needs", payload);
  return data;
}

export async function updateSupportNeed(id, payload) {
  const { data } = await api.put(`/support-needs/${id}`, payload);
  return data;
}

export async function deleteSupportNeed(id) {
  await api.delete(`/support-needs/${id}`);
}

// No update function for support entries on purpose -- they're
// point-in-time ledger records, not editable in place (see the route's
// comment); fix a mistake by deleting the bad entry and adding a new one.
export async function fetchSupportEntries(params = {}) {
  const { data } = await api.get("/support-entries", { params });
  return data;
}

export async function createSupportEntry(payload) {
  const { data } = await api.post("/support-entries", payload);
  return data;
}

export async function deleteSupportEntry(id) {
  await api.delete(`/support-entries/${id}`);
}

// Optional { partnerId, tripType, year } filters — the Trip History page
// used to fetch every partner with all their relations and flatten the
// trips out client-side; this is one query instead.
export async function fetchTrips(params = {}) {
  const { data } = await api.get("/trips", { params });
  return data;
}

export async function createTrip(payload) {
  const { data } = await api.post("/trips", payload);
  return data;
}

export async function updateTrip(id, payload) {
  const { data } = await api.put(`/trips/${id}`, payload);
  return data;
}

export async function deleteTrip(id) {
  await api.delete(`/trips/${id}`);
}

export async function fetchPrayerRequests(params = {}) {
  const { data } = await api.get("/prayer-requests", { params });
  return data;
}

export async function createPrayerRequest(payload) {
  const { data } = await api.post("/prayer-requests", payload);
  return data;
}

export async function updatePrayerRequest(id, payload) {
  const { data } = await api.put(`/prayer-requests/${id}`, payload);
  return data;
}

export async function deletePrayerRequest(id) {
  await api.delete(`/prayer-requests/${id}`);
}

export async function fetchNewsletters(params = {}) {
  const { data } = await api.get("/newsletters", { params });
  return data;
}

export async function uploadNewsletter(formData) {
  const { data } = await api.post("/newsletters", formData);
  return data;
}

export async function deleteNewsletter(id) {
  await api.delete(`/newsletters/${id}`);
}

// Everything but the file itself is editable -- see the PUT route comment
// in backend/src/routes/newsletters.js.
export async function updateNewsletter(id, data) {
  const { data: updated } = await api.put(`/newsletters/${id}`, data);
  return updated;
}

// Returns { prayerRequests: [...], oneTimeNeeds: [...] } -- nothing is
// persisted server-side, the caller reviews and explicitly adds each one
// (see ExtractionReviewModal.jsx).
export async function extractFromNewsletter(id) {
  const { data } = await api.post(`/newsletters/${id}/extract`);
  return data;
}

export async function fetchDocuments(params = {}) {
  const { data } = await api.get("/documents", { params });
  return data;
}

export async function uploadDocument(formData) {
  const { data } = await api.post("/documents", formData);
  return data;
}

export async function deleteDocument(id) {
  await api.delete(`/documents/${id}`);
}

// Everything but the file itself is editable -- see the PUT route comment
// in backend/src/routes/documents.js.
export async function updateDocument(id, data) {
  const { data: updated } = await api.put(`/documents/${id}`, data);
  return updated;
}

// See extractFromNewsletter above -- same shape, same nothing-persisted behavior.
export async function extractFromDocument(id) {
  const { data } = await api.post(`/documents/${id}/extract`);
  return data;
}

export async function fetchSetupStatus() {
  const { data } = await api.get("/auth/setup-status");
  return data; // { needed: boolean }
}

export async function completeSetup(email, password) {
  const { data } = await api.post("/auth/setup", { email, password });
  return data; // { user } — the backend also sets the session cookie, same as login
}

export async function login(email, password) {
  const { data } = await api.post("/auth/login", { email, password });
  // MFA-enabled accounts get a pendingToken (verify a code); accounts an
  // admin has required MFA on but haven't enrolled yet get a setupToken
  // (must enroll first) — neither is a real session. Otherwise the backend
  // has already set the session cookie; there's nothing left to do here.
  return data;
}

export async function verifyMfaLogin(pendingToken, token) {
  const { data } = await api.post("/auth/mfa/login-verify", { pendingToken, token });
  return data;
}

export async function setupMfa() {
  const { data } = await api.post("/auth/mfa/setup");
  return data; // { secret, qrCode }
}

export async function verifyMfaSetup(token) {
  const { data } = await api.post("/auth/mfa/verify-setup", { token });
  return data;
}

export async function disableMfa(password) {
  const { data } = await api.post("/auth/mfa/disable", { password });
  return data;
}

export async function resetUserMfa(id) {
  const { data } = await api.post(`/users/${id}/mfa/reset`);
  return data;
}

// These two use the setupToken issued alongside `mfaSetupRequired: true`
// from /auth/login — there's no session cookie yet at this point, so it's
// passed explicitly as a Bearer header instead (the one place this app
// still uses bearer-style auth; see requireAuthOrMfaSetup on the backend).
// Uses a plain axios request rather than the shared `api` instance simply
// because there's no reason to route it through the same instance — no
// interceptor to avoid anymore, but no shared config needed either.
export async function startForcedMfaSetup(setupToken) {
  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/mfa/setup`,
    {},
    { headers: { Authorization: `Bearer ${setupToken}` } }
  );
  return data;
}

export async function confirmForcedMfaSetup(setupToken, token) {
  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/mfa/verify-setup`,
    { token },
    { headers: { Authorization: `Bearer ${setupToken}` } }
  );
  return data;
}

export async function logout() {
  // The session is an httpOnly cookie — client-side JS can't clear it
  // itself, so this has to be a real request; the backend clears it via
  // Set-Cookie in response.
  await api.post("/auth/logout");
}

export async function fetchCurrentUser() {
  try {
    const { data } = await api.get("/auth/me");
    return data.user;
  } catch {
    return null; // no session cookie, or an expired one
  }
}

export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.post("/auth/change-password", { currentPassword, newPassword });
  return data;
}

export async function fetchUsers() {
  const { data } = await api.get("/users");
  return data;
}

export async function fetchUser(id) {
  const { data } = await api.get(`/users/${id}`);
  return data;
}

export async function createUser(payload) {
  const { data } = await api.post("/users", payload);
  return data;
}

export async function updateUser(id, payload) {
  const { data } = await api.put(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id) {
  await api.delete(`/users/${id}`);
}

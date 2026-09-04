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

export async function fetchPublicMissionaries() {
  const { data } = await api.get("/public/missionaries");
  return data;
}

export async function fetchPublicMissionary(id) {
  const { data } = await api.get(`/public/missionaries/${id}`);
  return data;
}

export async function fetchPublicOrganizations() {
  const { data } = await api.get("/public/organizations");
  return data;
}

export async function fetchPublicOrganization(id) {
  const { data } = await api.get(`/public/organizations/${id}`);
  return data;
}

export async function fetchCountryInfo(countryCode) {
  const { data } = await api.get(`/public/country-info/${countryCode}`);
  return data;
}

export async function fetchAdminMissionaries() {
  const { data } = await api.get("/missionaries");
  return data;
}

export async function fetchAdminMissionary(id) {
  const { data } = await api.get(`/missionaries/${id}`);
  return data;
}

export async function createMissionary(payload) {
  const { data } = await api.post("/missionaries", payload);
  return data;
}

export async function updateMissionary(id, payload) {
  const { data } = await api.put(`/missionaries/${id}`, payload);
  return data;
}

export async function deleteMissionary(id) {
  await api.delete(`/missionaries/${id}`);
}

export async function archiveMissionary(id) {
  const { data } = await api.post(`/missionaries/${id}/archive`);
  return data;
}

export async function unarchiveMissionary(id) {
  const { data } = await api.post(`/missionaries/${id}/unarchive`);
  return data;
}

export async function uploadMissionaryImage(id, file, receivedDate) {
  const formData = new FormData();
  formData.append("image", file);
  if (receivedDate) formData.append("receivedDate", receivedDate);
  const { data } = await api.post(`/missionaries/${id}/image`, formData);
  return data;
}

export async function deleteMissionaryPhoto(id, photoId) {
  await api.delete(`/missionaries/${id}/photos/${photoId}`);
}

export async function fetchAdminOrganizations() {
  const { data } = await api.get("/organizations");
  return data;
}

export async function fetchAdminOrganization(id) {
  const { data } = await api.get(`/organizations/${id}`);
  return data;
}

export async function createOrganization(payload) {
  const { data } = await api.post("/organizations", payload);
  return data;
}

export async function updateOrganization(id, payload) {
  const { data } = await api.put(`/organizations/${id}`, payload);
  return data;
}

export async function deleteOrganization(id) {
  await api.delete(`/organizations/${id}`);
}

export async function archiveOrganization(id) {
  const { data } = await api.post(`/organizations/${id}/archive`);
  return data;
}

export async function unarchiveOrganization(id) {
  const { data } = await api.post(`/organizations/${id}/unarchive`);
  return data;
}

export async function uploadOrganizationImage(id, file, receivedDate) {
  const formData = new FormData();
  formData.append("image", file);
  if (receivedDate) formData.append("receivedDate", receivedDate);
  const { data } = await api.post(`/organizations/${id}/image`, formData);
  return data;
}

export async function deleteOrganizationPhoto(id, photoId) {
  await api.delete(`/organizations/${id}/photos/${photoId}`);
}

export async function fetchChurchSettings() {
  const { data } = await api.get("/settings");
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

export async function fetchSupportNeeds() {
  const { data } = await api.get("/support-needs");
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

export async function fetchNewsletters() {
  const { data } = await api.get("/newsletters");
  return data;
}

export async function uploadNewsletter(formData) {
  const { data } = await api.post("/newsletters", formData);
  return data;
}

export async function getNewsletterDownloadUrl(id) {
  const { data } = await api.get(`/newsletters/${id}/download`);
  return data.url;
}

export async function deleteNewsletter(id) {
  await api.delete(`/newsletters/${id}`);
}

export async function fetchDocuments() {
  const { data } = await api.get("/documents");
  return data;
}

export async function uploadDocument(formData) {
  const { data } = await api.post("/documents", formData);
  return data;
}

export async function getDocumentDownloadUrl(id) {
  const { data } = await api.get(`/documents/${id}/download`);
  return data.url;
}

export async function deleteDocument(id) {
  await api.delete(`/documents/${id}`);
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

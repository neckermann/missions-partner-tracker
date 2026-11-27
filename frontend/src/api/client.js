import axios from "axios";
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

// Same-origin "/api": Vite proxies it in dev (vite.config.js), Express serves both in production.
export const api = axios.create({
  baseURL: "/api",
});

// A session that ends mid-use (expired, or MFA became required and this account hasn't enrolled)
// sends the user back to sign in. Skips /auth/* calls: a wrong password is also a 401, and the
// admin shell checks /auth/me itself.
export function signInAgainIfSessionEnded(error, { pathname, search }, redirect) {
  const url = error?.config?.url || "";
  if (error?.response?.status === 401 && pathname.startsWith("/admin") && !url.startsWith("/auth/")) {
    redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
}
api.interceptors.response.use(
  (response) => response,
  (error) => {
    signInAgainIfSessionEnded(error, window.location, (to) => window.location.assign(to));
    return Promise.reject(error);
  }
);

// No token attached: the session is an httpOnly cookie the browser sends itself, so client JS
// (and any XSS) never sees a credential.

// Missionaries and organizations are one resource; pass { kind: "missionary" } to narrow.
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

// Public digest subscriptions, shared by the subscribe page and the per-partner follow form.
export async function subscribeToDigest({ email, cadence, allPartners, partnerIds }) {
  const { data } = await api.post("/public/subscribe", { email, cadence, allPartners, partnerIds });
  return data; // { message }
}

// fetchPartners returns summary rows; fetchPartner adds the one-per-partner sub-records. History
// collections have their own endpoints below so a section fetches only what it shows.

export async function fetchPartners(params = {}) {
  const { data } = await api.get("/partners", { params });
  return data;
}

// The options for the "Sending church" filter: ours first, then every other church.
export async function fetchSendingChurches() {
  const { data } = await api.get("/partners/sending-churches");
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

// Partial update: only the keys sent are touched. Collection arrays are ignored (each has its
// own endpoint).
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

// Overwrites every "Sent by our church" partner with Church Settings' current info (the
// deliberate counterpart to the blanks-only auto-fill). Returns { updatedCount }.
export async function syncAllSendingChurch() {
  const { data } = await api.post("/partners/sync-sending-church");
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

// Admin-role only: a non-admin account just won't see the banner (see UpdateBanner.jsx).
export async function fetchVersionCheck() {
  const { data } = await api.get("/version-check");
  return data;
}

export async function fetchSystemInfo() {
  const { data } = await api.get("/system-info");
  return data;
}

// Asks for the admin's password again (and, if given, locks the file with a passphrase), then saves the file
// the server sends. A failed request answers with JSON but arrives as a Blob, so its message is read out here.
export async function downloadBackup({ password, passphrase }) {
  let res;
  try {
    res = await api.post(
      "/backups/download",
      { password, ...(passphrase ? { passphrase } : {}) },
      { responseType: "blob" }
    );
  } catch (err) {
    const blob = err.response?.data;
    if (blob && typeof blob.text === "function") {
      try {
        err.message = JSON.parse(await blob.text()).error || err.message;
      } catch {
        // keep the original message
      }
    }
    throw err;
  }
  const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || "backup.ndjson.gz";
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

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

// Admin-only. The access token never appears in any response.
export async function fetchGroupMeSettings() {
  const { data } = await api.get("/settings/groupme");
  return data;
}

export async function updateGroupMeSettings(payload) {
  const { data } = await api.put("/settings/groupme", payload);
  return data;
}

// Live GroupMe lookups for the pickers; 400s until a token is saved.
export async function fetchGroupMeGroups() {
  const { data } = await api.get("/settings/groupme/groups");
  return data;
}

export async function fetchGroupMeTopics(groupId) {
  const { data } = await api.get(`/settings/groupme/groups/${encodeURIComponent(groupId)}/topics`);
  return data;
}

// Admin-only and behind the `whatsapp` feature (404 when off). The linked session lives
// encrypted server-side and is never returned.
export async function fetchWhatsAppSettings() {
  const { data } = await api.get("/settings/whatsapp");
  return data;
}

export async function updateWhatsAppSettings(payload) {
  const { data } = await api.put("/settings/whatsapp", payload);
  return data;
}

// Starts pairing; read the result back by polling fetchWhatsAppPairStatus().
export async function startWhatsAppPairing() {
  const { data } = await api.post("/settings/whatsapp/pair", {});
  return data;
}

export async function fetchWhatsAppPairStatus() {
  const { data } = await api.get("/settings/whatsapp/pair/status");
  return data; // { status, qrDataUrl, error, health }
}

// Live lookups against the linked WhatsApp account, for the pickers.
export async function fetchWhatsAppCommunities() {
  const { data } = await api.get("/settings/whatsapp/communities");
  return data;
}

export async function fetchWhatsAppGroups(communityId) {
  const { data } = await api.get(`/settings/whatsapp/communities/${encodeURIComponent(communityId)}/groups`);
  return data;
}

export async function unlinkWhatsApp() {
  const { data } = await api.post("/settings/whatsapp/unlink");
  return data;
}

// Admin-only. The API key never appears in any response.
export async function fetchJoshuaProjectSettings() {
  const { data } = await api.get("/settings/joshua-project");
  return data;
}

export async function updateJoshuaProjectSettings(payload) {
  const { data } = await api.put("/settings/joshua-project", payload);
  return data;
}

// Admin-only. The API key never appears in any response; the model name is not a secret.
export async function fetchAiExtractionSettings() {
  const { data } = await api.get("/settings/ai-extraction");
  return data;
}

export async function updateAiExtractionSettings(payload) {
  const { data } = await api.put("/settings/ai-extraction", payload);
  return data;
}

// Sending and receiving share one admin-only route pair but are gated independently
// (backend/src/utils/features.js). The server token and webhook password never appear in a
// response. sendTestEmail() sends to the caller's own address.
export async function fetchEmailSettings() {
  const { data } = await api.get("/settings/email");
  return data;
}

export async function updateEmailSettings(payload) {
  const { data } = await api.put("/settings/email", payload);
  return data;
}

export async function sendTestEmail() {
  const { data } = await api.post("/settings/email/test");
  return data;
}

// Review queue: inbound emails that matched no partner. assign files one as a PartnerFile
// (kind defaults to "newsletter" server-side); discard removes it without filing.
export async function fetchPendingInboundEmails() {
  const { data } = await api.get("/inbound-email");
  return data;
}

// The backend /assign route takes partnerId XOR tripParticipantId. For a participant it files a
// TripDocument, which has no kind, so kind/customKind are ignored.
export async function assignInboundEmail(
  id,
  { partnerId, tripParticipantId, requirementId, kind, customKind }
) {
  const { data } = await api.post(`/inbound-email/${id}/assign`, {
    partnerId,
    tripParticipantId,
    requirementId,
    kind,
    customKind,
  });
  return data;
}

export async function discardInboundEmail(id) {
  await api.delete(`/inbound-email/${id}`);
}

// Dispatch schedules, channel mutes and email appearance are church-wide ChurchSettings, written
// back as whole objects like every other settings sub-resource. fetchPendingDispatches is the
// review queue; channels only send on their own schedule or via an urgent dispatch.
export async function fetchDispatchSettings() {
  const { data } = await api.get("/settings/dispatches");
  return data;
}

export async function updateDispatchSettings(payload) {
  const { data } = await api.put("/settings/dispatches", payload);
  return data;
}

// Counts only, never addresses. Any logged-in role can read it.
export async function fetchScopedDigestSummary() {
  const { data } = await api.get("/scoped-digest/summary");
  return data; // { adminSubscribedCount, publicConfirmedCount, publicUnconfirmedCount }
}

export async function fetchPendingDispatches() {
  const { data } = await api.get("/dispatches/pending");
  return data;
}

export async function fetchNotificationSummary() {
  const { data } = await api.get("/notifications/summary");
  return data.categories;
}

export async function markNotificationSeen(category) {
  await api.post("/notifications/seen", { category });
}

// The real (unmasked) text behind a queued row. GET /pending always shows the masked version
// for a restricted partner; this is the separate "let an admin look before editing" lookup.
export async function revealPendingDispatch(id) {
  const { data } = await api.get(`/dispatches/pending/${id}`);
  return data;
}

// Saves an admin's edit to a queued row's text. For a restricted real-content row, saving also
// clears it to send (dispatchEligibility.js needsReview()), so callers must confirm the exact
// text first: ApproveRestrictedTextConfirmBody + useConfirmDialog, or a same-dialog confirm step
// when already inside a Modal (nested Modals break Escape; see DispatchReviewModal.jsx).
export async function updatePendingDispatch(id, text) {
  const { data } = await api.put(`/dispatches/pending/${id}`, { text });
  return data;
}

// Discards one queued dispatch without sending it on any channel.
export async function deletePendingDispatch(id) {
  await api.delete(`/dispatches/pending/${id}`);
}

// Real admin/public subscriber counts for the "Mark as urgent" confirm dialog. Any UI that sets
// isUrgent on creation must reuse UrgentSendConfirmBody + useConfirmDialog so the audience list
// comes from one place (utils/urgentSend.js).
export async function fetchUrgentRecipientCount(partnerId) {
  const { data } = await api.get("/dispatches/urgent-recipient-count", { params: { partnerId } });
  return data; // { adminCount, publicCount }
}

export async function fetchPublicSettings() {
  const { data } = await api.get("/public/settings");
  return data;
}

// Every collection fetcher takes an optional { partnerId } to scope it to one partner.
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

// No update for support entries: they are point-in-time ledger records. Fix a mistake by
// deleting the entry and adding a new one.
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

// Per-row create/update/delete resources, not accepted on a partner update.
export async function fetchAdults(params = {}) {
  const { data } = await api.get("/adults", { params });
  return data;
}
export async function createAdult(payload) {
  const { data } = await api.post("/adults", payload);
  return data;
}
export async function updateAdult(id, payload) {
  const { data } = await api.put(`/adults/${id}`, payload);
  return data;
}
export async function deleteAdult(id) {
  await api.delete(`/adults/${id}`);
}

export async function fetchChildren(params = {}) {
  const { data } = await api.get("/children", { params });
  return data;
}
export async function createChild(payload) {
  const { data } = await api.post("/children", payload);
  return data;
}
export async function updateChild(id, payload) {
  const { data } = await api.put(`/children/${id}`, payload);
  return data;
}
export async function deleteChild(id) {
  await api.delete(`/children/${id}`);
}

export async function fetchFurloughs(params = {}) {
  const { data } = await api.get("/furloughs", { params });
  return data;
}
export async function createFurlough(payload) {
  const { data } = await api.post("/furloughs", payload);
  return data;
}
export async function updateFurlough(id, payload) {
  const { data } = await api.put(`/furloughs/${id}`, payload);
  return data;
}
export async function deleteFurlough(id) {
  await api.delete(`/furloughs/${id}`);
}

// Contact log. The type/direction/topic lists come from the server so the UI keeps no copy.
export async function fetchContactLogOptions() {
  const { data } = await api.get("/contact-log/options");
  return data;
}
export async function fetchContactLog(params = {}) {
  const { data } = await api.get("/contact-log", { params });
  return data;
}
// Every entry this login may read, newest first, with optional partnerId/contactType/direction/topic
// filters, paged (limit/offset): { rows, total, hasMore }.
export async function fetchContactLogAll(params = {}) {
  const { data } = await api.get("/contact-log/all", { params });
  return data;
}
// Church visits and newsletters filed, read-only, shown alongside the log's own entries.
export async function fetchContactTimeline(partnerId) {
  const { data } = await api.get("/contact-log/timeline", { params: { partnerId } });
  return data.events;
}
// What is still waiting to be passed on for a partner (a decided need, an answered prayer),
// so the page can offer a one-tap "log a thank-you".
export async function fetchContactUpdates(partnerId) {
  const { data } = await api.get("/contact-log/updates", { params: { partnerId } });
  return data.updates;
}
export async function createContactLogEntry(payload) {
  const { data } = await api.post("/contact-log", payload);
  return data;
}
export async function updateContactLogEntry(id, payload) {
  const { data } = await api.put(`/contact-log/${id}`, payload);
  return data;
}
export async function deleteContactLogEntry(id) {
  await api.delete(`/contact-log/${id}`);
}
export async function fetchAssignedPartners() {
  const { data } = await api.get("/contact-log/assigned");
  return data;
}

export async function fetchChurchVisits(params = {}) {
  const { data } = await api.get("/church-visits", { params });
  return data;
}
export async function createChurchVisit(payload) {
  const { data } = await api.post("/church-visits", payload);
  return data;
}
export async function updateChurchVisit(id, payload) {
  const { data } = await api.put(`/church-visits/${id}`, payload);
  return data;
}
export async function deleteChurchVisit(id) {
  await api.delete(`/church-visits/${id}`);
}

export async function fetchPartnerLinks(params = {}) {
  const { data } = await api.get("/partner-links", { params });
  return data;
}
export async function createPartnerLink(payload) {
  const { data } = await api.post("/partner-links", payload);
  return data;
}
export async function updatePartnerLink(id, payload) {
  const { data } = await api.put(`/partner-links/${id}`, payload);
  return data;
}
export async function deletePartnerLink(id) {
  await api.delete(`/partner-links/${id}`);
}

export async function fetchPartnerLanguages(params = {}) {
  const { data } = await api.get("/partner-languages", { params });
  return data;
}
export async function createPartnerLanguage(payload) {
  const { data } = await api.post("/partner-languages", payload);
  return data;
}
export async function updatePartnerLanguage(id, payload) {
  const { data } = await api.put(`/partner-languages/${id}`, payload);
  return data;
}
export async function deletePartnerLanguage(id) {
  await api.delete(`/partner-languages/${id}`);
}

export async function fetchTripTypes(params = {}) {
  const { data } = await api.get("/trip-types", { params });
  return data;
}
export async function createTripType(payload) {
  const { data } = await api.post("/trip-types", payload);
  return data;
}
export async function updateTripType(id, payload) {
  const { data } = await api.put(`/trip-types/${id}`, payload);
  return data;
}
export async function deleteTripType(id) {
  await api.delete(`/trip-types/${id}`);
}

// Optional { partnerId, tripType, year } filters.
// Reports: listReports returns picker metadata, runReport the rows. The CSV download is a plain
// same-origin navigation so the browser handles the file.
export async function listReports() {
  const { data } = await api.get("/reports");
  return data;
}

export async function runReport(id, params = {}) {
  const { data } = await api.get(`/reports/${id}`, { params });
  return data;
}

// Builds the Download CSV URL: same endpoint and params as runReport, so the file matches the screen.
export function reportCsvUrl(id, params = {}) {
  const query = new URLSearchParams({ ...params, format: "csv" });
  return `/api/reports/${id}?${query}`;
}

// Saved report views (a named set of filters) and their email schedules.
export async function listSavedViews(reportId) {
  const { data } = await api.get("/reports/views", { params: { reportId } });
  return data;
}
export async function createSavedView(payload) {
  const { data } = await api.post("/reports/views", payload);
  return data;
}
export async function deleteSavedView(id) {
  await api.delete(`/reports/views/${id}`);
}
export async function createReportSchedule(viewId, payload) {
  const { data } = await api.post(`/reports/views/${viewId}/schedule`, payload);
  return data;
}
export async function deleteReportSchedule(id) {
  await api.delete(`/reports/schedules/${id}`);
}

export async function fetchTrips(params = {}) {
  const { data } = await api.get("/trips", { params });
  return data;
}

export async function createTrip(payload) {
  const { data } = await api.post("/trips", payload);
  return data;
}

// Finish a trip in one step: actual dates, debrief, album link, optional partner contact.
export async function wrapUpTrip(id, payload) {
  const { data } = await api.post(`/trips/${id}/wrap-up`, payload);
  return data;
}

export async function updateTrip(id, payload) {
  const { data } = await api.put(`/trips/${id}`, payload);
  return data;
}

export async function deleteTrip(id) {
  await api.delete(`/trips/${id}`);
}

export async function fetchTripPlanning() {
  const { data } = await api.get("/trips/planning");
  return data;
}
export async function fetchTrip(id) {
  const { data } = await api.get(`/trips/${id}`);
  return data;
}
export async function cloneTrip(id) {
  const { data } = await api.post(`/trips/${id}/clone`);
  return data;
}
export async function generateApplicationLink(tripId) {
  const { data } = await api.post(`/trips/${tripId}/generate-application-link`);
  return data;
}
export async function fetchTripApplications(tripId) {
  const { data } = await api.get(`/trips/${tripId}/applications`);
  return data;
}
export async function reviewTripApplication(applicationId, status, declinedReason) {
  const { data } = await api.put(`/trips/applications/${applicationId}`, { status, declinedReason });
  return data;
}
export async function addTripParticipant(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/participants`, payload);
  return data;
}
export async function generateSupportRaisingLink(participantId) {
  const { data } = await api.post(`/trips/participants/${participantId}/generate-support-raising-link`);
  return data;
}
// One admin route for everything editable on a participant's behalf. payload is any subset of
// { firstName, lastName, email, phone, story, photo (base64), photoContentType }.
export async function updateTripParticipant(participantId, payload) {
  const { data } = await api.put(`/trips/participants/${participantId}`, payload);
  return data;
}
export async function resendParticipantAccessLink(participantId) {
  const { data } = await api.post(`/trips/participants/${participantId}/request-access-link`);
  return data;
}
// A requirement is a document or a plain task, optionally with a due date and reminder lead
// time; payload is { label, kind?, dueAt?, reminderLeadDays?, minorsOnly? }.
export async function addTripRequirement(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/requirements`, payload);
  return data;
}
export async function updateTripRequirement(id, payload) {
  const { data } = await api.put(`/trips/requirements/${id}`, payload);
  return data;
}
export async function deleteTripRequirement(id) {
  await api.delete(`/trips/requirements/${id}`);
}
// Trip-wide planned-expense lines; payload is { label, estimatedAmount }.
export async function addTripBudgetLine(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/budget-lines`, payload);
  return data;
}
export async function updateTripBudgetLine(id, payload) {
  const { data } = await api.put(`/trips/budget-lines/${id}`, payload);
  return data;
}
export async function deleteTripBudgetLine(id) {
  await api.delete(`/trips/budget-lines/${id}`);
}
export async function addTripFlightSegment(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/flight-segments`, payload);
  return data;
}
export async function updateTripFlightSegment(id, payload) {
  const { data } = await api.put(`/trips/flight-segments/${id}`, payload);
  return data;
}
export async function deleteTripFlightSegment(id) {
  await api.delete(`/trips/flight-segments/${id}`);
}
// Task-kind only: a document requirement is fulfilled by uploading its document instead.
export async function setTripRequirementComplete(requirementId, participantId, completed) {
  const { data } = await api.put(
    `/trips/requirements/${requirementId}/participants/${participantId}/complete`,
    { completed }
  );
  return data;
}
export async function addTripContribution(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/contributions`, payload);
  return data;
}
// Manually logs a received document. Other paths into TripDocument: inbound-email /assign and
// the participant's self-service upload. participantId/requirementId/title are all optional.
export async function uploadTripDocument(tripId, file, { participantId, requirementId, title } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (participantId) formData.append("participantId", participantId);
  if (requirementId) formData.append("requirementId", requirementId);
  if (title) formData.append("title", title);
  const { data } = await api.post(`/trips/${tripId}/documents`, formData);
  return data;
}
export async function deleteTripDocument(id) {
  await api.delete(`/trips/documents/${id}`);
}
export async function scheduleTripMeeting(tripId, payload) {
  const { data } = await api.post(`/trips/${tripId}/meetings`, payload);
  return data;
}
export async function updateTripMeeting(id, payload) {
  const { data } = await api.put(`/trips/meetings/${id}`, payload);
  return data;
}
export async function resendTripMeetingInvite(id) {
  const { data } = await api.post(`/trips/meetings/${id}/resend`);
  return data;
}
export async function cancelTripMeeting(id) {
  const { data } = await api.post(`/trips/meetings/${id}/cancel`);
  return data;
}
export async function deleteTripMeeting(id) {
  await api.delete(`/trips/meetings/${id}`);
}

// Trips church-wide settings, in their own sub-route.
export async function fetchTripsSettings() {
  const { data } = await api.get("/settings/trips");
  return data;
}
export async function updateTripsSettings(payload) {
  const { data } = await api.put("/settings/trips", payload);
  return data;
}

// Trips public surfaces: no auth, feature-gated server-side.
export async function fetchPublicTrips() {
  const { data } = await api.get("/public/trips");
  return data;
}
export async function fetchPublicTrip(id) {
  const { data } = await api.get(`/public/trips/${id}`);
  return data;
}
export async function fetchPublicTripByToken(token) {
  const { data } = await api.get(`/public/trips/by-token/${token}`);
  return data;
}
export async function submitTripApplication(id, payload) {
  const { data } = await api.post(`/public/trips/${id}/apply`, payload);
  return data;
}
export async function submitTripApplicationByToken(token, payload) {
  const { data } = await api.post(`/public/trips/by-token/${token}/apply`, payload);
  return data;
}
export async function fetchPublicTripParticipantByToken(shareToken) {
  const { data } = await api.get(`/public/trips/participants/by-token/${shareToken}`);
  return data;
}
export async function fetchTripParticipantSelfService(accessToken) {
  const { data } = await api.get(`/public/trips/participants/access`, { params: { token: accessToken } });
  return data;
}
export async function requestTripParticipantAccessLink(email) {
  const { data } = await api.post(`/public/trips/participants/request-access-link`, { email });
  return data;
}
// payload is { token, signerName, signatureImage? }. The server generates and files a signed PDF.
export async function signTripRequirement(requirementId, payload) {
  const { data } = await api.post(`/public/trips/participants/sign/${requirementId}`, payload);
  return data;
}
// Multipart (carries a file; shared type/size rules in backend/src/utils/upload.js). Re-uploading
// via the same link replaces the prior file.
export async function uploadTripRequirementDocument(requirementId, { token, file }) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post(
    `/public/trips/participants/upload/${requirementId}?token=${encodeURIComponent(token)}`,
    formData
  );
  return data;
}
// Self-service edit: { token, story?, photo? (base64 data URL), photoContentType? }.
export async function updateTripParticipantSelfService(payload) {
  const { data } = await api.put(`/public/trips/participants/self-service`, payload);
  return data;
}
// Public by design. Returns the route path, not bytes: point an <img> at it.
export function tripParticipantPhotoUrl(participantId) {
  return `/api/public/trips/participants/${participantId}/photo`;
}
// Token-gated: the token travels as a query param. Returns the route path, not bytes.
export function tripDocumentDownloadUrl(documentId, token) {
  return `/api/public/trips/participants/documents/${documentId}/download?token=${encodeURIComponent(token)}`;
}

// Plain GET link so the browser/calendar app handles the .ics download.
export function tripMeetingIcsUrl(meetingId, token) {
  return `/api/public/trips/meetings/${meetingId}/ics?token=${encodeURIComponent(token)}`;
}

// Plain GET link to the route the email invite's RSVP links use; records the response server-side.
export function tripMeetingRsvpUrl(meetingId, response, token) {
  return `/api/public/trips/meetings/${meetingId}/rsvp?token=${encodeURIComponent(token)}&response=${response}`;
}

export async function fetchPrayerRequests(params = {}) {
  const { data } = await api.get("/prayer-requests", { params });
  return data;
}

// The Sunday prayer sheet: { date, cadence, group, totalPartners, partners } (backend/src/utils/prayerSheet.js).
export async function fetchPrayerSheet({ date, cadence, perPartner } = {}) {
  const { data } = await api.get("/prayer-sheet", { params: { date, cadence, perPartner } });
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

export async function fetchPartnerFiles(params = {}) {
  const { data } = await api.get("/partner-files", { params });
  return data;
}

export async function uploadPartnerFile(formData) {
  const { data } = await api.post("/partner-files", formData);
  return data;
}

export async function deletePartnerFile(id) {
  await api.delete(`/partner-files/${id}`);
}

// Everything but the file itself is editable, including `kind`.
export async function updatePartnerFile(id, data) {
  const { data: updated } = await api.put(`/partner-files/${id}`, data);
  return updated;
}

// Returns { prayerRequests, oneTimeNeeds }; nothing is persisted until the caller adds each.
// A restricted partner's letter is only sent once the caller confirms (confirmRestricted: true); until then
// the server answers 409 with needsConfirmation.
export async function extractFromPartnerFile(id, { confirmRestricted = false } = {}) {
  const { data } = await api.post(
    `/partner-files/${id}/extract`,
    confirmRestricted ? { confirmRestricted: true } : {}
  );
  return data;
}

export async function fetchSetupStatus() {
  const { data } = await api.get("/auth/setup-status");
  return data; // { needed, passwordless, passwordReset: booleans }
}

export async function completeSetup(email, password) {
  const { data } = await api.post("/auth/setup", { email, password });
  return data; // { user } — the backend also sets the session cookie, same as login
}

export async function login(email, password) {
  const { data } = await api.post("/auth/login", { email, password });
  // MFA-enabled accounts get a pendingToken (verify a code); accounts that must enroll get a
  // setupToken. Neither is a real session; otherwise the cookie is already set.
  return data;
}

// `code` is the 6-digit authenticator code, or, with `{ recovery: true }`, a one-time recovery code.
export async function verifyMfaLogin(pendingToken, code, { recovery = false } = {}) {
  const { data } = await api.post(
    "/auth/mfa/login-verify",
    recovery ? { pendingToken, recoveryCode: code } : { pendingToken, token: code }
  );
  return data;
}

// A fresh set of recovery codes (the old ones stop working). Needs the current password.
export async function regenerateRecoveryCodes(password) {
  const { data } = await api.post("/auth/mfa/recovery-codes", { password });
  return data; // { recoveryCodes }
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

// Sent as an explicit Bearer setupToken (no session cookie yet during forced enrolment): the one
// place this app uses bearer auth. Plain axios, not the shared `api` instance.
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

// Passkeys: the server hands out WebAuthn options plus a signed challenge token that goes back
// with the browser's answer.
export async function fetchPasskeys() {
  const { data } = await api.get("/auth/passkeys");
  return data; // { passkeys: [{ id, label, createdAt, lastUsedAt }], max }
}

// `setupToken` is given during forced enrolment (no session yet); otherwise the cookie does it.
export async function registerPasskey(label, setupToken) {
  const config = setupToken ? { headers: { Authorization: `Bearer ${setupToken}` } } : undefined;
  const { data: begin } = await api.post("/auth/passkeys/register/options", {}, config);
  const response = await startRegistration({ optionsJSON: begin.options });
  const { data } = await api.post(
    "/auth/passkeys/register/verify",
    { challengeToken: begin.challengeToken, response, label },
    config
  );
  return data;
}

export async function removePasskey(id, password) {
  const { data } = await api.delete(`/auth/passkeys/${id}`, { data: { password } });
  return data;
}

export async function loginWithPasskey(pendingToken) {
  const { data: begin } = await api.post("/auth/passkeys/login/options", { pendingToken });
  const response = await startAuthentication({ optionsJSON: begin.options });
  const { data } = await api.post("/auth/passkeys/login/verify", {
    pendingToken,
    challengeToken: begin.challengeToken,
    response,
  });
  return data;
}

// Passwordless sign-in: a passkey, or an emailed one-time link.
export async function signInWithPasskeyOnly() {
  const { data: begin } = await api.post("/auth/passkeys/passwordless/options");
  const response = await startAuthentication({ optionsJSON: begin.options });
  const { data } = await api.post("/auth/passkeys/passwordless/verify", {
    challengeToken: begin.challengeToken,
    response,
  });
  return data;
}

export async function requestSignInLink(email) {
  const { data } = await api.post("/auth/passwordless/email-link", { email });
  return data;
}

export async function redeemSignInLink(token) {
  const { data } = await api.post("/auth/passwordless/link/redeem", { token });
  return data;
}

export { browserSupportsWebAuthn };

export async function logout() {
  // The session is an httpOnly cookie JS can't clear, so this is a real request.
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

// Turn the daily key-date email on or off for yourself; the bell alert is unaffected.
export async function setKeyDateEmailOptOut(optOut) {
  const { data } = await api.put("/auth/key-date-email", { optOut });
  return data.user;
}
// Your own phone and a line about yourself (how you help, when you are easiest to reach).
export async function updateMyProfile({ phone, profile }) {
  const { data } = await api.put("/auth/profile", { phone, profile });
  return data.user;
}
// digestScope: "owned" (the partners you look after), "all", or "followed" (the partnerIds you pick).
export async function updateNotifyByEmail({ cadence, digestScope, partnerIds }) {
  const { data } = await api.put("/auth/dispatch-by-email", { cadence, digestScope, partnerIds });
  return data.user;
}

// `inactive: true` lists only guest accounts that can't currently sign in.
export async function fetchUsers({ inactive = false } = {}) {
  const { data } = await api.get("/users", { params: inactive ? { inactive: true } : undefined });
  return data;
}

// --- Guest trip access (admin only) ---
// A grant's `expiresAt` is only an override; `effectiveExpiresAt` is what applies (the
// override, else trip end + 30 days, else null = no expiry).
export async function fetchUserTripAccess(userId) {
  const { data } = await api.get(`/users/${userId}/trip-access`);
  return data;
}
export async function fetchTripGuests(tripId) {
  const { data } = await api.get(`/users/by-trip/${tripId}`);
  return data;
}
export async function addUserTripAccess(userId, { tripId, expiresAt = null }) {
  const { data } = await api.post(`/users/${userId}/trip-access`, { tripId, expiresAt });
  return data;
}
// expiresAt: a date to extend or end early, null to go back to the derived date.
export async function setUserTripAccessExpiry(userId, tripId, expiresAt) {
  const { data } = await api.put(`/users/${userId}/trip-access/${tripId}`, { expiresAt });
  return data;
}
export async function removeUserTripAccess(userId, tripId) {
  const { data } = await api.delete(`/users/${userId}/trip-access/${tripId}`);
  return data;
}

export async function fetchUser(id) {
  const { data } = await api.get(`/users/${id}`);
  return data;
}

// Sends (or re-sends) the welcome email to an account with no password yet.
export async function sendUserSetupLink(id) {
  const { data } = await api.post(`/users/${id}/setup-link`);
  return data;
}

export async function validatePasswordSetup(token) {
  const { data } = await api.post("/auth/password-setup/validate", { token });
  return data;
}
export async function completePasswordSetup(token, password) {
  const { data } = await api.post("/auth/password-setup/complete", { token, password });
  return data;
}
export async function requestPasswordSetupLink(email) {
  const { data } = await api.post("/auth/password-setup/request", { email });
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

// Care teams (gated by the careTeam feature; 404 when off). A team is { lead: member|null,
// members: [member] }; a guest viewer gets no member emails.
export async function fetchCareTeam(partnerId) {
  const { data } = await api.get(`/care-team/${partnerId}`);
  return data;
}
// Replaces the whole team in one go.
export async function setCareTeam(partnerId, { leadUserId, memberUserIds }) {
  const { data } = await api.put(`/care-team/${partnerId}`, { leadUserId, memberUserIds });
  return data;
}
// Active logins a team can be made from (admin/editor).
// The key dates coming up for the partners you look after, as plain lines (what the daily email would say), so a
// church with email off can copy them. { emailOn, items: [{ partnerId, when, text }] }
export async function fetchMyKeyDates() {
  const { data } = await api.get("/key-dates/mine");
  return data;
}
// The missions team: who looks after partners with no care team of their own (admin/editor read, admin set).
// { members: [{ id, name, email, role }], candidates: [...] }
export async function fetchMissionsTeam() {
  const { data } = await api.get("/partner-care/missions-team");
  return data;
}
// Replaces the whole team with exactly these logins.
export async function saveMissionsTeam(userIds) {
  const { data } = await api.put("/partner-care/missions-team", { userIds });
  return data.members;
}
export async function fetchCareTeamCandidates() {
  const { data } = await api.get("/care-team/candidates");
  return data;
}

// Support preferences (gated by supportPreferences + careTeam; 404 when off). The church's menu
// (admin): { id, group, label, kind, choices[], allowOther, sortOrder, active, answerCount }.
export async function fetchSupportOptions() {
  const { data } = await api.get("/support-preferences/options");
  return data;
}
export async function createSupportOption(option) {
  const { data } = await api.post("/support-preferences/options", option);
  return data;
}
export async function updateSupportOption(id, patch) {
  const { data } = await api.put(`/support-preferences/options/${id}`, patch);
  return data;
}
export async function deleteSupportOption(id) {
  await api.delete(`/support-preferences/options/${id}`);
}
export async function renameSupportGroup(from, to) {
  const { data } = await api.post("/support-preferences/options/rename-group", { from, to });
  return data;
}
export async function fetchSupportKinds() {
  const { data } = await api.get("/support-preferences/kinds");
  return data.kinds;
}
// A partner's choices: { options: [menu], preferences: [...], canEdit }.
export async function fetchPartnerSupportPreferences(partnerId) {
  const { data } = await api.get(`/support-preferences/partner/${partnerId}`);
  return data;
}
export async function savePartnerSupportPreferences(partnerId, preferences) {
  const { data } = await api.put(`/support-preferences/partner/${partnerId}`, { preferences });
  return data;
}

// Partner surveys (gated by surveys; 404 when off).
export async function fetchSurveys() {
  const { data } = await api.get("/surveys");
  return data.surveys;
}
export async function createSurvey(body) {
  const { data } = await api.post("/surveys", body);
  return data;
}
export async function fetchSurvey(id) {
  const { data } = await api.get(`/surveys/${id}`);
  return data;
}
export async function updateSurvey(id, patch) {
  const { data } = await api.put(`/surveys/${id}`, patch);
  return data;
}
export async function deleteSurvey(id) {
  await api.delete(`/surveys/${id}`);
}
export async function saveSurveyQuestions(id, questions) {
  const { data } = await api.put(`/surveys/${id}/questions`, { questions });
  return data.questions;
}
export async function fetchSurveyRecipients(id) {
  const { data } = await api.get(`/surveys/${id}/recipients`);
  return data.recipients;
}
// -> { sent, skipped: [{ partnerId, name, reason }] }
export async function createSurveyLink(id, partnerId) {
  const { data } = await api.post(`/surveys/${id}/link`, { partnerId });
  return data;
}

export async function sendSurvey(id, partnerIds, reminder = false) {
  const { data } = await api.post(`/surveys/${id}/send`, { partnerIds, reminder });
  return data;
}
export async function fetchSurveyResponses(id) {
  const { data } = await api.get(`/surveys/${id}/responses`);
  return data;
}
// { canEdit, surveys: [{ id, title, intro, status, questions, response, invite }] }
export async function fetchPartnerSurveys(partnerId) {
  const { data } = await api.get(`/surveys/partner/${partnerId}`);
  return data;
}
export async function savePartnerSurvey(surveyId, partnerId, answers, submit) {
  const { data } = await api.put(`/surveys/${surveyId}/partner/${partnerId}`, { answers, submit });
  return data;
}
export async function reopenSurveyResponse(surveyId, partnerId) {
  await api.post(`/surveys/${surveyId}/partner/${partnerId}/reopen`);
}
// The partner's own page, reached by the link in their email (no login).
export async function fetchPublicSurvey(token) {
  const { data } = await api.get(`/public/surveys/${encodeURIComponent(token)}`);
  return data;
}
export async function savePublicSurvey(token, answers) {
  const { data } = await api.put(`/public/surveys/${encodeURIComponent(token)}`, { answers });
  return data;
}
export async function submitPublicSurvey(token, answers) {
  const { data } = await api.post(`/public/surveys/${encodeURIComponent(token)}/submit`, { answers });
  return data;
}

// The parts of a partner's record a question can propose a change to: [{ key, label, kinds }].
export async function fetchSurveyFields() {
  const { data } = await api.get("/surveys/fields");
  return data.fields;
}
// Changes survey answers suggest, for a person to decide. status: "pending" or "decided".
export async function fetchSurveyUpdates(status = "pending") {
  const { data } = await api.get("/survey-updates", { params: { status } });
  return data.updates;
}
export async function approveSurveyUpdate(id, value) {
  const { data } = await api.post(`/survey-updates/${id}/approve`, value === undefined ? {} : { value });
  return data;
}
export async function rejectSurveyUpdate(id) {
  const { data } = await api.post(`/survey-updates/${id}/reject`);
  return data;
}
export async function uploadPublicSurveyPhoto(token, questionId, contentType, base64) {
  const { data } = await api.post(
    `/public/survey-uploads/${encodeURIComponent(token)}/${encodeURIComponent(questionId)}`,
    { contentType, data: base64 }
  );
  return data;
}

// Template packs (admin): a church's starting points as plain JSON. Preview says what an import
// would do; import only ever adds. Export is a download link (the session cookie rides along).
export async function previewTemplatePack(pack) {
  const { data } = await api.post("/template-packs/preview", { pack });
  return data;
}
export async function importTemplatePack(pack) {
  const { data } = await api.post("/template-packs/import", { pack });
  return data;
}
export const templatePackExportUrl = (kind, params = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/api/template-packs/export/${kind}${q ? `?${q}` : ""}`;
};

// The partners this login may read, as { id, kind, displayName, archived }: all of them for a
// full role, only grant-reachable ones for a guest. For pickers when a guest can't list the directory.
export async function fetchReachablePartners() {
  const { data } = await api.get("/partners/reachable");
  return data;
}

// Audit log. Empty filters are dropped, not sent as "".
const withoutBlanks = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v));
export async function fetchAuditLog(params = {}) {
  const { data } = await api.get("/audit", { params: withoutBlanks(params) });
  return data;
}
export async function fetchAuditMeta() {
  const { data } = await api.get("/audit/meta");
  return data;
}
export async function setAuditRetention(days) {
  const { data } = await api.put("/audit/retention", { days });
  return data;
}
// A plain link the browser downloads; the filters on screen are the filters exported.
export function auditExportUrl(params = {}) {
  const query = new URLSearchParams(Object.entries(withoutBlanks(params))).toString();
  return `${api.defaults.baseURL}/audit/export${query ? `?${query}` : ""}`;
}

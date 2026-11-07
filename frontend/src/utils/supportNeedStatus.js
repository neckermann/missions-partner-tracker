// Derives a one-time need's funding status pill from its approved vs.
// requested amount -- same labels/thresholds the backend's GroupMe
// decided-notification uses (supportNeedOutcomeLabel in
// backend/src/utils/groupmeChannel.js) so the message matches what the
// admin UI calls the same decision; that one can't share this file
// directly (it runs in Node, this runs in the browser), but keeping the
// two labelings in sync by hand is a smaller problem than the one this
// file actually fixes (see #135): statusFor() in AdminOneTimeNeeds.jsx
// and needStatus() in PartnerFinancialSection.jsx were the same
// function under two names.
export function supportNeedStatus(need) {
  if (need.approvedAmount == null) return { label: "Pending Decision", tone: "warn" };
  if (need.approvedAmount === 0) return { label: "Declined", tone: "warn" };
  if (need.approvedAmount < need.requestedAmount) return { label: "Partially Funded", tone: "good" };
  return { label: "Fully Funded", tone: "good" };
}

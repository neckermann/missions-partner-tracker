// Derives a one-time need's funding status pill from approved vs. requested amount. Same
// labels/thresholds as supportNeedOutcomeLabel in backend/src/utils/groupmeChannel.js, which can't
// share this file (Node vs browser): keep them in sync by hand.
export function supportNeedStatus(need) {
  if (need.approvedAmount == null) return { label: "Pending Decision", tone: "warn" };
  if (need.approvedAmount === 0) return { label: "Declined", tone: "warn" };
  if (need.approvedAmount < need.requestedAmount) return { label: "Partially Funded", tone: "good" };
  return { label: "Fully Funded", tone: "good" };
}

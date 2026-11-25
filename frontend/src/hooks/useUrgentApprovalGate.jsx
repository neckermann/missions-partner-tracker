import React from "react";
import { fetchUrgentRecipientCount } from "../api/client.js";
import UrgentSendConfirmBody from "../components/admin/UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";

// Shared by every create flow that can be marked urgent or, for a restricted partner,
// approved-and-sent-now. Resolves to false if either confirmation is declined; the caller should
// then abort without saving.
export default function useUrgentApprovalGate({ confirmDialog, enabledFeatures }) {
  return async function confirmBeforeCreate({ approveNow, isUrgent, partnerId, text }) {
    if (approveNow) {
      const approved = await confirmDialog({
        title: "Approve and send now?",
        body: <ApproveRestrictedTextConfirmBody text={text} />,
        confirmLabel: "Approve and save",
      });
      if (!approved) return false;
    }
    if (isUrgent) {
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(partnerId);
      const sent = await confirmDialog({
        title: "Send now?",
        body: (
          <UrgentSendConfirmBody
            enabledFeatures={enabledFeatures}
            adminCount={adminCount}
            publicCount={publicCount}
          />
        ),
        confirmLabel: "Send now",
      });
      if (!sent) return false;
    }
    return true;
  };
}

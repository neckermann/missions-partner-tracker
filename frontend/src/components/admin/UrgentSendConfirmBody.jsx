import React from "react";
import { urgentRecipientSummary, reachableUrgentChannels, chatChannelNames } from "../../utils/urgentSend.js";

// The urgent-send confirm dialog's body: a lead sentence plus a .field-warning safety-rules
// callout, naming only the audiences this church's settings can reach (urgentRecipientSummary).
export default function UrgentSendConfirmBody({ enabledFeatures, adminCount, publicCount }) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const summary = urgentRecipientSummary(enabledFeatures, { adminCount, publicCount });
  const chatNames = chatChannelNames(reach);

  return (
    <div>
      <p style={{ marginTop: 0 }}>
        This will immediately notify <strong>{summary}</strong>, bypassing everyone's own schedule.
      </p>
      <div className="field-warning">
        Still waits on review if this partner is restricted
        {chatNames.length > 0 && `, and still respects a muted ${chatNames.join("/")} content type`} -- urgent
        only skips the wait, never those safety rules.
      </div>
    </div>
  );
}

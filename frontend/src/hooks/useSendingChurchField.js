import { useEffect, useMemo, useState } from "react";
import { fetchSendingChurches } from "../api/client.js";
import { SENDING_CHURCH_FILTER_FIELD } from "../utils/partnerEntity.js";
import useCurrentUser from "./useCurrentUser.js";

// The "Sending church" FilterBar field with its options filled in from the server
// (our own church first, then every other, each with its partner count). Returns
// null for a guest, who cannot list churches: spread it as `...(field ? [field] : [])`.
// Until the options arrive (or if the request fails) the field offers only "All".
export default function useSendingChurchField() {
  const { isGuest } = useCurrentUser();
  const [options, setOptions] = useState([]);

  useEffect(() => {
    if (isGuest) return;
    fetchSendingChurches()
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [isGuest]);

  return useMemo(() => {
    if (isGuest) return null;
    return {
      ...SENDING_CHURCH_FILTER_FIELD,
      options: [
        { value: "all", label: "All" },
        ...options.map((o) => ({ value: o.value, label: `${o.label} (${o.count})` })),
      ],
    };
  }, [isGuest, options]);
}

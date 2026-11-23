import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPartner } from "../api/client.js";

export default function usePartnerUrlFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerId = searchParams.get("partnerId");
  const [partnerName, setPartnerName] = useState(null);

  useEffect(() => {
    if (!partnerId) {
      setPartnerName(null);
      return;
    }
    let cancelled = false;
    fetchPartner(partnerId)
      .then((p) => {
        if (!cancelled) setPartnerName(p.displayName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  function clearPartnerFilter() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("partnerId");
        return next;
      },
      { replace: true }
    );
  }

  function setPartnerFilter(id) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("partnerId", id);
        else next.delete("partnerId");
        return next;
      },
      { replace: true }
    );
  }

  return { partnerId, partnerName, clearPartnerFilter, setPartnerFilter };
}

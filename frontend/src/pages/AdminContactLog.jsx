import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchContactLogAll, fetchContactLogOptions, fetchReachablePartners } from "../api/client.js";
import FilterBar from "../components/shared/FilterBar.jsx";
import PageHeader from "../components/shared/PageHeader.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Table from "../components/shared/Table.jsx";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useFilterState from "../hooks/useFilterState.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import { formatDateLong } from "../utils/format.js";

const PAGE = 50;
const emptyFilters = { contactType: "all", direction: "all", topic: "all" };
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "—";

// Every logged contact this login may read, newest first, filtered by partner, type, direction
// or topic. A partner's own page shows only the latest few and links here with that partner
// already chosen. Editing and deleting stay on the partner's page.
export default function AdminContactLog() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [partners, setPartners] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchContactLogOptions()
      .then(setOptions)
      .catch(() => setOptions({ types: [], directions: [], topics: [] }));
    fetchReachablePartners()
      .then(setPartners)
      .catch(() => setPartners([]));
  }, []);

  const all = (list) => [
    { value: "all", label: "All" },
    ...(list || []).map((x) => ({ value: x.value, label: x.label })),
  ];
  const fields = useMemo(
    () => [
      { name: "contactType", label: "Type", type: "select", options: all(options?.types) },
      { name: "direction", label: "Direction", type: "select", options: all(options?.directions) },
      { name: "topic", label: "About", type: "select", options: all(options?.topics) },
    ],
    [options]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);
  const { partnerId, partnerName, clearPartnerFilter, setPartnerFilter } = usePartnerUrlFilter();

  const query = useCallback(
    (offset) => ({
      limit: PAGE,
      offset,
      ...(partnerId ? { partnerId } : {}),
      ...(filters.contactType !== "all" ? { contactType: filters.contactType } : {}),
      ...(filters.direction !== "all" ? { direction: filters.direction } : {}),
      ...(filters.topic !== "all" ? { topic: filters.topic } : {}),
    }),
    [partnerId, filters.contactType, filters.direction, filters.topic]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchContactLogAll(query(0))
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setError("");
      })
      .catch(() => !cancelled && setError("Couldn't load the contact log."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function loadMore() {
    const r = await fetchContactLogAll(query(rows.length));
    setRows((prev) => [...prev, ...r.rows]);
    setTotal(r.total);
  }

  const label = (list, value) => list?.find((x) => x.value === value)?.label || value;

  return (
    <div className="admin-shell">
      <PageHeader
        title="Contact Log"
        subtitle={
          loading
            ? null
            : `${total} ${total === 1 ? "entry" : "entries"}${partnerName ? ` for ${partnerName}` : ""}`
        }
        description="Every call, text, email, visit or card logged with a partner. Add or fix an entry on the partner's own page."
      />
      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        extraChips={
          <PartnerFilterChip
            partnerId={partnerId}
            partnerName={partnerName}
            partners={partners}
            onSelect={setPartnerFilter}
            onClear={clearPartnerFilter}
          />
        }
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Table
        style={{ marginTop: "1rem" }}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/partners/${r.partner.id}#contact-log`)}
        rowHref={(r) => `/admin/partners/${r.partner.id}#contact-log`}
        emptyMessage={loading ? "Loading…" : "No contact logged yet."}
        columns={[
          { key: "partner", label: "Partner", render: (r) => r.partner.displayName },
          { key: "contactDate", label: "Date", render: (r) => formatDateLong(r.contactDate) },
          {
            key: "type",
            label: "What",
            render: (r) =>
              `${label(options?.types, r.contactType)} · ${label(options?.directions, r.direction)}`,
          },
          {
            key: "topics",
            label: "About",
            render: (r) =>
              [
                ...(r.topics || []).map((t) => label(options?.topics, t)),
                r.supportOptionLabel && `re: ${r.supportOptionLabel}`,
              ]
                .filter(Boolean)
                .join(", ") || "—",
          },
          { key: "by", label: "By", render: (r) => nameOf(r.contactedBy) },
          { key: "notes", label: "Notes", render: (r) => r.notes || "—" },
        ]}
      />
      <LoadMoreButton hasMore={rows.length < total} remaining={total - rows.length} onClick={loadMore} />
    </div>
  );
}

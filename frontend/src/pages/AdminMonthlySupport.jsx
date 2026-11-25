import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPartners, fetchSupportEntries, createSupportEntry, deleteSupportEntry } from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SupportEntryFormFields from "../components/admin/SupportEntryFormFields.jsx";
import { formatDate, todayInputValue, formatCurrency as formatMoney } from "../utils/format.js";
import { partnerKindLabel, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import useSendingChurchField from "../hooks/useSendingChurchField.js";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";

// Thin binding so the call sites below stay unchanged; the formatting
// itself lives in utils/format.js, which is also where the em-dash
// convention for "no amount recorded" is documented.
const formatCurrency = (amount) => formatMoney(amount, { fallback: "—" });

const emptyNewEntry = { partnerId: "", amount: "", effectiveDate: todayInputValue(), notes: "" };
const emptyFilters = { sendingChurch: "all", includeArchived: false };

// Phase 2 of the UX-rebuild plan: this page already used the expanded-row-
// below-the-row pattern by hand (History toggle) -- Table's own
// expandedRowId/renderExpanded was built for exactly this, so this
// migration is close to a 1:1 lift rather than a redesign. Left client-side
// (no FilterBar date-range/entity-type added): this dataset has one real
// filter dimension (archived) and a small row count -- see the plan's own
// "Backend filter-support judgment calls" table.
export default function AdminMonthlySupport() {
  const { canWrite, isAdmin } = useCurrentUser();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState(emptyNewEntry);
  // The partner whose full history is expanded, plus that history. It's
  // fetched on demand rather than arriving with every row: the summary
  // list carries only each partner's *current* amount, which is all the
  // table itself shows.
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const navigate = useNavigate();

  const sendingChurchField = useSendingChurchField();
  const fields = useMemo(
    () => [...(sendingChurchField ? [sendingChurchField] : []), INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD],
    [sendingChurchField]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);
  const {
    partnerId: filterPartnerId,
    partnerName: filterPartnerName,
    clearPartnerFilter,
    setPartnerFilter,
  } = usePartnerUrlFilter();

  // Clicking History on partner A, then quickly clicking it on partner B
  // before A's slower fetch resolves, would otherwise let A's history
  // land in the panel after B's already did. Tracks which partner the
  // most recent loadHistory() call was actually for, checked when it
  // resolves -- not just closed over, since toggleHistory can move this
  // on before an in-flight fetch finishes.
  const historyForRef = useRef(null);

  function reload() {
    fetchPartners(filters.sendingChurch !== "all" ? { sendingChurch: filters.sendingChurch } : {})
      .then(setPartners)
      .catch(console.error);
    if (historyFor) loadHistory(historyFor);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.sendingChurch]);

  function loadHistory(partnerId) {
    historyForRef.current = partnerId;
    fetchSupportEntries({ partnerId })
      .then((data) => {
        if (historyForRef.current === partnerId) setHistory(data);
      })
      .catch(console.error);
  }

  // Arriving here via a partner's own "View all" link is specifically
  // about that partner's support history, not just their current amount --
  // open it automatically instead of making that a second click.
  useEffect(() => {
    if (filterPartnerId) {
      setHistoryFor(filterPartnerId);
      loadHistory(filterPartnerId);
    }
  }, [filterPartnerId]);

  function toggleHistory(partnerId) {
    if (historyFor === partnerId) {
      historyForRef.current = null;
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    setHistoryFor(partnerId);
    setHistory([]);
    loadHistory(partnerId);
  }

  // fetchPartners returns each partner's latest support entry (the summary
  // select takes 1, ordered by effectiveDate desc), which is exactly what
  // this table shows.
  const rows = partners
    .map((p) => ({
      id: p.id,
      type: partnerKindLabel(p.kind),
      name: p.displayName,
      field: p.fieldDisplayName,
      archived: p.archived,
      amount: p.supportEntries?.[0]?.amount,
      effectiveDate: p.supportEntries?.[0]?.effectiveDate,
      current: p.supportEntries?.[0],
      link: `/admin/partners/${p.id}`,
    }))
    .filter((r) => r.current) // only partners with a support amount on file
    .filter((r) => filters.includeArchived || !r.archived)
    .filter((r) => !filterPartnerId || r.id === filterPartnerId)
    .sort((a, b) => b.current.amount - a.current.amount);

  const total = rows.reduce((sum, r) => sum + r.current.amount, 0);

  async function submitAddEntry() {
    if (!newEntry.partnerId) throw new Error("Choose a partner");
    await createSupportEntry({
      partnerId: newEntry.partnerId,
      amount: newEntry.amount,
      effectiveDate: newEntry.effectiveDate,
      notes: newEntry.notes || null,
    });
    setNewEntry(emptyNewEntry);
    reload();
  }

  async function handleDeleteEntry(entry) {
    const confirmed = await confirmDialog({
      title: `Delete the ${formatCurrency(entry.amount)} entry effective ${formatDate(entry.effectiveDate)}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteSupportEntry(entry.id);
    reload();
  }

  return (
    <div className="admin-shell">
      {filterPartnerId && (
        <Breadcrumb
          items={[
            { label: "Partners", to: "/admin/partners" },
            { label: filterPartnerName || "…", to: `/admin/partners/${filterPartnerId}` },
            { label: "Monthly Support" },
          ]}
        />
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <h2>Monthly Support</h2>
        {canWrite && (
          <button className="btn" onClick={() => setShowAddForm(true)}>
            + Add Support Entry
          </button>
        )}
      </div>

      {canWrite && showAddForm && (
        <QuickActionModal
          title="Add Support Entry"
          onClose={() => setShowAddForm(false)}
          onSubmit={submitAddEntry}
          submitLabel="Save Entry"
        >
          <SupportEntryFormFields
            form={newEntry}
            setForm={setNewEntry}
            partnerPicker={
              <label
                style={{ gridColumn: "1 / -1" }}
                title="A new support amount takes effect as of the date below -- it doesn't overwrite prior entries, which stay on file as history."
              >
                Partner
                <PartnerSelect
                  partners={partners}
                  value={newEntry.partnerId}
                  onChange={(partnerId) => setNewEntry((f) => ({ ...f, partnerId }))}
                  required
                />
              </label>
            }
          />
        </QuickActionModal>
      )}

      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        extraChips={
          <PartnerFilterChip
            partnerId={filterPartnerId}
            partnerName={filterPartnerName}
            partners={partners}
            onSelect={setPartnerFilter}
            onClear={clearPartnerFilter}
          />
        }
      />

      <div className="admin-section" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Total monthly support ({rows.length}):
          </span>
          <span style={{ fontSize: "1.3rem", fontWeight: 700 }}>{formatCurrency(total)}</span>
        </div>
      </div>

      <Table
        style={{ marginTop: "1rem" }}
        rows={rows}
        rowKey={(row) => row.id}
        rowAttrs={(row) => ({ "data-partner-id": row.id })}
        onRowClick={(row) => navigate(row.link)}
        emptyMessage="No support entries on file yet."
        expandedRowId={historyFor}
        renderExpanded={() => (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Effective Date</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatCurrency(entry.amount)}</td>
                  <td>{formatDate(entry.effectiveDate)}</td>
                  <td>{entry.notes || "—"}</td>
                  <td className="table-actions">
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn danger small"
                        onClick={() => handleDeleteEntry(entry)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        columns={[
          {
            key: "name",
            label: "Name",
            render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
          },
          { key: "field", label: "Field / Region" },
          { key: "amount", label: "Monthly Amount", type: "currency" },
          { key: "effectiveDate", label: "Effective Date", type: "date" },
        ]}
        renderActions={(row) => (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => toggleHistory(row.id)}
            title="View and correct past support entries for this partner"
          >
            {historyFor === row.id ? "Hide History" : "History"}
          </button>
        )}
      />
      {confirmElement}
    </div>
  );
}

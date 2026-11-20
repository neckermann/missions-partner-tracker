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
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";

// Thin binding so the call sites below stay unchanged; the formatting
// itself lives in utils/format.js, which is also where the em-dash
// convention for "no amount recorded" is documented.
const formatCurrency = (amount) => formatMoney(amount, { fallback: "—" });

const emptyNewEntry = { partnerId: "", amount: "", effectiveDate: todayInputValue(), notes: "" };
const emptyFilters = { includeArchived: false };

// Phase 2 of the UX-rebuild plan: this page already used the expanded-row-
// below-the-row pattern by hand (History toggle) -- Table's own
// expandedRowId/renderExpanded was built for exactly this, so this
// migration is close to a 1:1 lift rather than a redesign. Left client-side
// (no FilterBar date-range/entity-type added): this dataset has one real
// filter dimension (archived) and a small row count -- see the plan's own
// "Backend filter-support judgment calls" table.
export default function AdminMonthlySupport() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState(emptyNewEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The partner whose full history is expanded, plus that history. It's
  // fetched on demand rather than arriving with every row: the summary
  // list carries only each partner's *current* amount, which is all the
  // table itself shows.
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const navigate = useNavigate();

  const fields = useMemo(() => [INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD], []);
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);

  // Clicking History on partner A, then quickly clicking it on partner B
  // before A's slower fetch resolves, would otherwise let A's history
  // land in the panel after B's already did. Tracks which partner the
  // most recent loadHistory() call was actually for, checked when it
  // resolves -- not just closed over, since toggleHistory can move this
  // on before an in-flight fetch finishes.
  const historyForRef = useRef(null);

  function reload() {
    fetchPartners().then(setPartners).catch(console.error);
    if (historyFor) loadHistory(historyFor);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadHistory(partnerId) {
    historyForRef.current = partnerId;
    fetchSupportEntries({ partnerId })
      .then((data) => {
        if (historyForRef.current === partnerId) setHistory(data);
      })
      .catch(console.error);
  }

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
    .sort((a, b) => b.current.amount - a.current.amount);

  const total = rows.reduce((sum, r) => sum + r.current.amount, 0);

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newEntry.partnerId) {
      setError("Choose a partner");
      return;
    }
    setSaving(true);
    try {
      await createSupportEntry({
        partnerId: newEntry.partnerId,
        amount: newEntry.amount,
        effectiveDate: newEntry.effectiveDate,
        notes: newEntry.notes || null,
      });
      setNewEntry(emptyNewEntry);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save support entry");
    } finally {
      setSaving(false);
    }
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
        <button
          className="btn"
          onClick={() => {
            setShowAddForm((v) => !v);
            setError("");
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Support Entry"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
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
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Save Entry"}
            </button>
          </div>
        </form>
      )}

      <FilterBar fields={fields} values={filters} onChange={updateFilter} onReset={resetFilters} />

      <div className="admin-section" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
          <span style={{ fontSize: "0.85rem", color: "#555" }}>Total monthly support ({rows.length}):</span>
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
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => handleDeleteEntry(entry)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        columns={[
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
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

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  fetchSurvey,
  updateSurvey,
  deleteSurvey,
  saveSurveyQuestions,
  fetchSurveyRecipients,
  sendSurvey,
  fetchSurveyFields,
  fetchSurveyResponses,
  reopenSurveyResponse,
} from "../api/client.js";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import PageHeader from "../components/shared/PageHeader.jsx";
import StatTiles from "../components/shared/StatTiles.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import { describeSavedAnswer, choiceRowStyle, choiceInputStyle } from "../components/SurveyQuestions.jsx";
import { formatDate } from "../utils/format.js";

const KINDS = [
  { value: "text", label: "Free text" },
  { value: "yesno", label: "Yes / No" },
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "photo", label: "Photo" },
];

const blankQuestion = () => ({
  key: crypto.randomUUID(),
  kind: "text",
  label: "",
  choicesText: "",
  allowOther: false,
  required: false,
  field: "",
});
const toDraft = (q) => ({
  key: q.id,
  id: q.id,
  kind: q.kind,
  label: q.label,
  choicesText: (q.choices || []).join("\n"),
  allowOther: q.allowOther,
  required: q.required,
  field: q.field || "",
});

// One survey: its details and status, the questions, who it has gone to (and sending), and the answers.
export default function AdminSettingsSurveyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [survey, setSurvey] = useState(null);
  const [draft, setDraft] = useState([]);
  const [details, setDetails] = useState({ title: "", intro: "", closesAt: "" });
  const [recipients, setRecipients] = useState([]);
  const [fields, setFields] = useState([]);
  const [chosen, setChosen] = useState(new Set());
  const [results, setResults] = useState({ responses: [] });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [s, r, res] = await Promise.all([
        fetchSurvey(id),
        fetchSurveyRecipients(id),
        fetchSurveyResponses(id),
      ]);
      setSurvey(s);
      setDraft(s.questions.map(toDraft));
      setDetails({
        title: s.title,
        intro: s.intro || "",
        closesAt: s.closesAt ? s.closesAt.slice(0, 10) : "",
      });
      setRecipients(r);
      setResults(res);
    } catch {
      setError("Couldn't load this survey.");
    }
  }, [id]);
  useEffect(() => {
    reload();
    fetchSurveyFields()
      .then(setFields)
      .catch(() => setFields([]));
  }, [reload]);

  async function act(fn, done) {
    setError("");
    setMessage("");
    try {
      await fn();
      if (done) setMessage(done);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  const patchQ = (key, patch) => setDraft((d) => d.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const moveQ = (index, by) =>
    setDraft((d) => {
      const next = [...d];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  const saveQuestions = () =>
    act(
      () =>
        saveSurveyQuestions(
          id,
          draft.map((q) => ({
            id: q.id,
            kind: q.kind,
            label: q.label,
            choices: q.choicesText
              .split("\n")
              .map((c) => c.trim())
              .filter(Boolean),
            allowOther: q.allowOther,
            required: q.required,
            field: q.kind === "photo" ? "photo" : q.field || null,
          }))
        ),
      "Questions saved."
    );

  const saveDetails = () =>
    act(
      () =>
        updateSurvey(id, {
          title: details.title,
          intro: details.intro || null,
          closesAt: details.closesAt ? new Date(`${details.closesAt}T23:59:59`).toISOString() : null,
        }),
      "Details saved."
    );

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this survey?",
      body: <p>The survey and every answer to it will be removed. Close it instead to keep the answers.</p>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await act(async () => {
      await deleteSurvey(id);
      navigate("/admin/settings/surveys");
    });
  }

  async function send(reminder) {
    const ids = [...chosen];
    const ok = await confirmDialog({
      title: reminder ? "Send reminders?" : "Send this survey?",
      body: (
        <p>
          An email with a personal link goes to {ids.length} partner{ids.length === 1 ? "" : "s"}. An earlier
          link to the same partner stops working.
        </p>
      ),
      confirmLabel: "Send",
    });
    if (!ok) return;
    setError("");
    setMessage("");
    try {
      const r = await sendSurvey(id, ids, reminder);
      setMessage(
        `Sent to ${r.sent}.${r.skipped.length ? ` Not sent: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.` : ""}`
      );
      setChosen(new Set());
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  if (!survey) {
    return (
      <div className="admin-shell">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }

  const answered = recipients.filter((r) => r.state === "answered").length;
  const invited = recipients.filter((r) => r.state !== "not invited").length;
  const isOpen = survey.status === "open";
  const toggle = (pid) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  return (
    <div className="admin-shell">
      <Breadcrumb
        items={[
          { label: "Settings", to: "/admin/settings" },
          { label: "Surveys", to: "/admin/settings/surveys" },
          { label: survey.title },
        ]}
      />
      <PageHeader
        title={survey.title}
        subtitle={`${{ draft: "Draft", open: "Open", closed: "Closed" }[survey.status]} · ${survey.questions.length} question${survey.questions.length === 1 ? "" : "s"}`}
        actions={
          <>
            {survey.status !== "open" && (
              <button
                type="button"
                className="btn"
                onClick={() => act(() => updateSurvey(id, { status: "open" }), "The survey is open.")}
              >
                {survey.status === "closed" ? "Reopen" : "Open survey"}
              </button>
            )}
            {isOpen && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => act(() => updateSurvey(id, { status: "closed" }), "The survey is closed.")}
              >
                Close survey
              </button>
            )}
            <button type="button" className="btn danger" onClick={remove}>
              Delete
            </button>
          </>
        }
      />
      {message && (
        <p role="status" style={{ color: "var(--accent)" }}>
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <StatTiles
        ariaLabel="Survey progress"
        items={[
          { label: "Sent to", value: invited },
          { label: "Answered", value: answered },
          { label: "Waiting", value: Math.max(invited - answered, 0) },
        ]}
      />

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Details</h2>
        <div className="admin-section">
          <label>
            Title
            <input
              value={details.title}
              onChange={(e) => setDetails({ ...details, title: e.target.value })}
            />
          </label>
          <label>
            Introduction (shown to the partner, and in the email)
            <textarea
              rows={3}
              value={details.intro}
              onChange={(e) => setDetails({ ...details, intro: e.target.value })}
            />
          </label>
          <label>
            Closes on (optional)
            <input
              type="date"
              value={details.closesAt}
              onChange={(e) => setDetails({ ...details, closesAt: e.target.value })}
            />
          </label>
          <button type="button" className="btn" onClick={saveDetails} disabled={!details.title.trim()}>
            Save details
          </button>
        </div>
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Questions</h2>
        <div className="admin-section">
          {draft.length === 0 && <p style={{ color: "var(--muted)" }}>No questions yet.</p>}
          {draft.map((q, i) => (
            <div key={q.key} className="survey-question-row">
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select
                  aria-label={`Kind of question ${i + 1}`}
                  value={q.kind}
                  onChange={(e) => patchQ(q.key, { kind: e.target.value, field: "" })}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  style={{ flex: 1, minWidth: "12rem" }}
                  aria-label={`Question ${i + 1}`}
                  placeholder="The question"
                  value={q.label}
                  onChange={(e) => patchQ(q.key, { label: e.target.value })}
                />
              </div>
              {(q.kind === "single" || q.kind === "multiple") && (
                <>
                  <textarea
                    rows={3}
                    aria-label={`Choices for question ${i + 1}`}
                    placeholder="One choice per line"
                    value={q.choicesText}
                    onChange={(e) => patchQ(q.key, { choicesText: e.target.value })}
                  />
                  <label style={choiceRowStyle}>
                    <input
                      style={choiceInputStyle}
                      type="checkbox"
                      checked={q.allowOther}
                      onChange={(e) => patchQ(q.key, { allowOther: e.target.checked })}
                    />
                    <span>Offer a “something else” box</span>
                  </label>
                </>
              )}
              {(q.kind === "text" || q.kind === "single" || q.kind === "photo") && (
                <label>
                  {q.kind === "photo"
                    ? "A photo sent this way waits for you to approve it before it is added to their photos."
                    : "Suggest a change to their record (staff approve it first)"}
                  {q.kind !== "photo" && (
                    <select
                      aria-label={`Part of the record for question ${i + 1}`}
                      value={q.field}
                      onChange={(e) => patchQ(q.key, { field: e.target.value })}
                    >
                      <option value="">Just keep the answer</option>
                      {fields
                        .filter((f) => f.kinds.includes(q.kind))
                        .map((f) => (
                          <option key={f.key} value={f.key}>
                            Update: {f.label}
                          </option>
                        ))}
                    </select>
                  )}
                </label>
              )}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <label style={choiceRowStyle}>
                  <input
                    style={choiceInputStyle}
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => patchQ(q.key, { required: e.target.checked })}
                  />
                  <span>Required</span>
                </label>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={i === 0}
                  onClick={() => moveQ(i, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={i === draft.length - 1}
                  onClick={() => moveQ(i, 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => setDraft((d) => d.filter((x) => x.key !== q.key))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setDraft((d) => [...d, blankQuestion()])}
            >
              + Add question
            </button>
            <button
              type="button"
              className="btn"
              onClick={saveQuestions}
              disabled={draft.some((q) => !q.label.trim())}
            >
              Save questions
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Send</h2>
        <div className="admin-section">
          {!isOpen ? (
            <p style={{ color: "var(--muted)" }}>
              Open the survey to send it. A person starts every send; nothing is emailed automatically.
            </p>
          ) : (
            <>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                Choose who to send a personal link to. Partners the app may not email (restricted, or marked
                not to be contacted directly) or with no address can&apos;t be picked; fill the survey in for
                them from their page instead.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() =>
                    setChosen(
                      new Set(
                        recipients
                          .filter((r) => r.canEmail && r.state === "not invited")
                          .map((r) => r.partnerId)
                      )
                    )
                  }
                >
                  Select everyone not yet sent
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() =>
                    setChosen(
                      new Set(
                        recipients.filter((r) => r.canEmail && r.state === "invited").map((r) => r.partnerId)
                      )
                    )
                  }
                >
                  Select those still waiting
                </button>
                <button type="button" className="btn secondary small" onClick={() => setChosen(new Set())}>
                  Clear
                </button>
              </div>
              <div className="survey-recipients">
                {recipients.map((r) => (
                  <label key={r.partnerId} style={choiceRowStyle}>
                    <input
                      style={choiceInputStyle}
                      type="checkbox"
                      disabled={!r.canEmail || r.state === "answered"}
                      checked={chosen.has(r.partnerId)}
                      onChange={() => toggle(r.partnerId)}
                    />
                    <span>
                      {r.name}{" "}
                      <span style={{ color: "var(--muted)" }}>
                        · {r.state}
                        {r.sentAt ? ` ${formatDate(r.sentAt)}` : ""}
                        {!r.canEmail ? ` · can't email (${r.blockedReason})` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={chosen.size === 0}
                  onClick={() => send(false)}
                >
                  Send to {chosen.size}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={chosen.size === 0}
                  onClick={() => send(true)}
                >
                  Send as a reminder
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Answers</h2>
        {results.responses.length === 0 && <p style={{ color: "var(--muted)" }}>No answers yet.</p>}
        {results.responses.map((r) => (
          <div key={r.id} className="admin-section">
            <div
              style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}
            >
              <h3 style={{ margin: 0 }}>
                <Link to={`/admin/partners/${r.partner.id}`}>{r.partner.displayName}</Link>
              </h3>
              <span style={{ color: "var(--muted)" }}>
                {r.submittedAt ? `Answered ${formatDate(r.submittedAt)}` : "Saved, not finished"}
                {r.enteredByName ? ` · entered by ${r.enteredByName}` : ""}
              </span>
            </div>
            <dl style={{ margin: "0.5rem 0 0" }}>
              {r.answers.map((a) => (
                <div key={a.id} style={{ marginBottom: "0.4rem" }}>
                  <dt style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{a.label}</dt>
                  <dd style={{ margin: 0 }}>{describeSavedAnswer(a) || "—"}</dd>
                </div>
              ))}
            </dl>
            {r.submittedAt && (
              <button
                type="button"
                className="btn secondary small"
                onClick={() =>
                  act(
                    () => reopenSurveyResponse(id, r.partner.id),
                    "Reopened. They can change their answers again."
                  )
                }
              >
                Reopen
              </button>
            )}
          </div>
        ))}
      </div>
      {confirmElement}
    </div>
  );
}

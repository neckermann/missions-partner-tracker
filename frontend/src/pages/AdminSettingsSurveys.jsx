import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSurveys, createSurvey, fetchSurveyTemplates, createSurveyFromTemplate } from "../api/client.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Table from "../components/shared/Table.jsx";

const STATUS_LABEL = { draft: "Draft", open: "Open", closed: "Closed" };

// The church's surveys: a list, and a place to start a new one. Each survey's builder, sending and
// results live on its own page.
export default function AdminSettingsSurveys() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", intro: "", templateId: "" });
  const [templates, setTemplates] = useState([]);

  const reload = useCallback(
    () =>
      fetchSurveys()
        .then((s) => {
          setSurveys(s);
          setError("");
        })
        .catch(() => setError("Couldn't load the surveys.")),
    []
  );
  useEffect(() => {
    reload();
    fetchSurveyTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [reload]);

  async function submitNew() {
    const created = form.templateId
      ? await createSurveyFromTemplate(form.templateId, form.title.trim() || undefined)
      : await createSurvey({ title: form.title, intro: form.intro || null });
    navigate(`/admin/settings/surveys/${created.id}`);
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title="Surveys"
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => {
              setForm({ title: "", intro: "", templateId: "" });
              setCreating(true);
            }}
          >
            + New survey
          </button>
        }
      />
      <p style={{ color: "var(--muted)" }}>
        Short surveys a partner answers through a personal link, or that staff fill in for them after a
        conversation. Answers show on the partner&apos;s page for staff and their care team only.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {surveys && (
        <Table
          rows={surveys}
          onRowClick={(s) => navigate(`/admin/settings/surveys/${s.id}`)}
          emptyMessage="No surveys yet. Start one with + New survey."
          columns={[
            { key: "title", label: "Survey" },
            { key: "status", label: "Status", render: (s) => STATUS_LABEL[s.status] },
            { key: "questionCount", label: "Questions", type: "number" },
            { key: "invitedCount", label: "Sent to", type: "number" },
            { key: "answeredCount", label: "Answered", type: "number" },
          ]}
        />
      )}
      {creating && (
        <QuickActionModal
          title="New survey"
          onClose={() => setCreating(false)}
          onSubmit={submitNew}
          submitLabel="Create"
          submitDisabled={!form.templateId && !form.title.trim()}
        >
          <label>
            Start from
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
            >
              <option value="">A blank survey</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.questionCount} questions)
                </option>
              ))}
            </select>
          </label>
          {form.templateId && (
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {templates.find((t) => t.id === form.templateId)?.description} You can change every question
              afterwards.
            </p>
          )}
          <label>
            Title{form.templateId ? " (optional: the template's name is used if blank)" : ""}
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          {!form.templateId && (
            <label>
              Introduction (shown to the partner)
              <textarea
                rows={3}
                value={form.intro}
                onChange={(e) => setForm({ ...form, intro: e.target.value })}
              />
            </label>
          )}
        </QuickActionModal>
      )}
    </div>
  );
}

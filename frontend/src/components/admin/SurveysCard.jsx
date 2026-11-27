import React, { useCallback, useEffect, useState } from "react";
import { fetchPartnerSurveys, savePartnerSurvey } from "../../api/client.js";
import { formatDate } from "../../utils/format.js";
import Modal from "../Modal.jsx";
import QuickActionModal from "../shared/QuickActionModal.jsx";
import SurveyQuestions, {
  answersFromSaved,
  answersToPayload,
  describeSavedAnswer,
} from "../SurveyQuestions.jsx";
import PartnerSummaryCard from "./PartnerSummaryCard.jsx";

// The surveys open to a partner, and the ones they have answered. Staff and the care team fill one
// in for them ("Fill in"), or read what they sent. Renders nothing when the feature is off or the
// viewer can't reach it (the API answers 403/404).
export default function SurveysCard({ partnerId }) {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [filling, setFilling] = useState(null); // a survey
  const [viewing, setViewing] = useState(null);

  const reload = useCallback(
    () =>
      fetchPartnerSurveys(partnerId)
        .then(setData)
        .catch((err) => {
          if ([403, 404].includes(err.response?.status)) setHidden(true);
        }),
    [partnerId]
  );
  useEffect(() => {
    setHidden(false);
    reload();
  }, [reload]);

  if (hidden || !data) return null;

  const status = (s) => {
    if (s.response?.submittedAt) {
      return `answered ${formatDate(s.response.submittedAt)}${s.response.enteredByName ? ` by ${s.response.enteredByName}` : ""}`;
    }
    if (s.response) return "started, not finished";
    if (s.invite?.sentAt) return `link sent ${formatDate(s.invite.sentAt)}`;
    return "not sent";
  };

  return (
    <div id="section-surveys" style={{ scrollMarginTop: "1rem" }}>
      <PartnerSummaryCard
        icon="📝"
        title="Surveys"
        count={data.surveys.length}
        items={data.surveys.map((s) => ({
          text: `${s.title} · ${status(s)}`,
          onClick: () =>
            s.response?.submittedAt || !data.canEdit || s.status !== "open" ? setViewing(s) : setFilling(s),
        }))}
        empty="No open surveys."
      />
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} maxWidth="640px">
          <p style={{ color: "var(--muted)" }}>{status(viewing)}</p>
          {viewing.response?.answers?.length ? (
            <dl>
              {viewing.response.answers.map((a) => (
                <div key={a.id} style={{ marginBottom: "0.5rem" }}>
                  <dt style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{a.label}</dt>
                  <dd style={{ margin: 0 }}>
                    {describeSavedAnswer(
                      a,
                      data.supportMenu,
                      viewing.questions?.find((q) => q.id === a.questionId)
                    ) || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No answers yet.</p>
          )}
          {data.canEdit && viewing.status !== "draft" && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setFilling(viewing);
                setViewing(null);
              }}
            >
              {viewing.response ? "Edit answers" : "Fill in for them"}
            </button>
          )}
        </Modal>
      )}
      {filling && (
        <FillInModal
          survey={filling}
          partnerId={partnerId}
          supportMenu={data.supportMenu}
          onClose={() => setFilling(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function FillInModal({ survey, partnerId, supportMenu, onClose, onSaved }) {
  const [answers, setAnswers] = useState(() => answersFromSaved(survey.response?.answers));
  const change = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));
  const payload = () => answersToPayload(survey.questions, answers);

  return (
    <QuickActionModal
      title={survey.title}
      onClose={onClose}
      onSubmit={async () => {
        await savePartnerSurvey(survey.id, partnerId, payload(), true);
        await onSaved();
      }}
      submitLabel="Save as answered"
      maxWidth="640px"
    >
      <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        Filling this in for them. It shows who entered it.
      </p>
      <SurveyQuestions
        questions={survey.questions}
        answers={answers}
        onChange={change}
        supportMenu={supportMenu}
      />
      {!survey.response?.submittedAt && (
        <button
          type="button"
          className="btn secondary small"
          onClick={async () => {
            await savePartnerSurvey(survey.id, partnerId, payload(), false);
            await onSaved();
            onClose();
          }}
        >
          Save without finishing
        </button>
      )}
    </QuickActionModal>
  );
}

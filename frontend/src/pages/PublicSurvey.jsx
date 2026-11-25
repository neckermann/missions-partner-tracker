import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import SurveyQuestions, { answersFromSaved, answersToPayload } from "../components/SurveyQuestions.jsx";
import { fetchPublicSurvey, savePublicSurvey, submitPublicSurvey } from "../api/client.js";

// A partner's own page for a survey, reached by the personal link in their email. No account: the
// link is the only credential, so an unknown, expired or closed link all look the same.
export default function PublicSurvey() {
  const { token } = useParams();
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [state, setState] = useState("loading"); // loading | ready | unavailable | saved | done
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicSurvey(token)
      .then((s) => {
        if (cancelled) return;
        setSurvey(s);
        setAnswers(answersFromSaved(s.answers));
        setState(s.submitted ? "done" : "ready");
      })
      .catch(() => !cancelled && setState("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const change = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  async function send(submit) {
    setBusy(true);
    setError("");
    try {
      const payload = answersToPayload(survey.questions, answers);
      if (submit) await submitPublicSurvey(token, payload);
      else await savePublicSurvey(token, payload);
      setState(submit ? "done" : "saved");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PublicSiteHeader title={survey?.title || "Survey"} />
      <DemoBanner />
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        {state === "loading" && <p>Loading…</p>}
        {state === "unavailable" && (
          <p>
            This link isn&apos;t available. It may have expired or the survey may have closed. Please ask the
            church for a new one.
          </p>
        )}
        {(state === "ready" || state === "saved" || state === "done") && survey && (
          <>
            {survey.intro && <p style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>{survey.intro}</p>}
            {state === "done" && (
              <p role="status" style={{ color: "var(--accent)" }}>
                Thank you, your answers are in. You can change them below until the survey closes.
              </p>
            )}
            {state === "saved" && (
              <p role="status" style={{ color: "var(--accent)" }}>
                Saved. You can come back to this same link to finish later.
              </p>
            )}
            <SurveyQuestions
              questions={survey.questions}
              answers={answers}
              onChange={change}
              disabled={busy}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={busy} onClick={() => send(true)}>
                {state === "done" ? "Update my answers" : "Submit"}
              </button>
              {state !== "done" && (
                <button type="button" className="btn secondary" disabled={busy} onClick={() => send(false)}>
                  Save and finish later
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

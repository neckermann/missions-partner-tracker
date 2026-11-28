import React, { useEffect, useRef, useState } from "react";
import { prepareImage } from "../utils/prepareImage.js";
import { useParams } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import SurveyQuestions, { answersFromSaved, answersToPayload } from "../components/SurveyQuestions.jsx";
import {
  fetchPublicSurvey,
  savePublicSurvey,
  submitPublicSurvey,
  uploadPublicSurveyPhoto,
} from "../api/client.js";

// A partner's own page for a survey, reached by the personal link in their email. No account: the
// link is the only credential, so an unknown, expired or closed link all look the same.
export default function PublicSurvey() {
  const { token } = useParams();
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [state, setState] = useState("loading"); // loading | ready | unavailable | saved | done
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState([]);
  // Answers a "finish later" save could not keep: [{ questionId, label, error }].
  const [skipped, setSkipped] = useState([]);
  const resultRef = useRef(null);
  // Counts sends, so the result is scrolled into view after each one has been drawn.
  const [sends, setSends] = useState(0);

  useEffect(() => {
    // The result is beside the buttons, but on a long survey on a phone those can be off screen: bring it into view.
    if (sends > 0) resultRef.current?.scrollIntoView?.({ block: "center" });
  }, [sends]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicSurvey(token)
      .then((s) => {
        if (cancelled) return;
        setSurvey(s);
        setAnswers(answersFromSaved(s.answers));
        setPhotos(s.photos || []);
        setState(s.submitted ? "done" : "ready");
      })
      .catch(() => !cancelled && setState("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const change = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  async function sendPhoto(questionId, file) {
    setBusy(true);
    setError("");
    try {
      // Checked and shrunk here, before anything is sent (a phone photo can be 12 MB).
      const prepared = await prepareImage(file);
      if (prepared.error) {
        setError(prepared.error);
        return;
      }
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(prepared.file);
      });
      await uploadPublicSurveyPhoto(token, questionId, prepared.file.type, base64);
      setPhotos((p) => [...new Set([...p, questionId])]);
    } catch (err) {
      setError(err.response?.data?.error || "That photo couldn't be sent. Please try another.");
    } finally {
      setBusy(false);
    }
  }

  async function send(submit) {
    setBusy(true);
    setError("");
    setSkipped([]);
    try {
      const payload = answersToPayload(survey.questions, answers);
      const result = submit
        ? await submitPublicSurvey(token, payload)
        : await savePublicSurvey(token, payload);
      setSkipped(result?.skipped || []);
      setState(submit ? "done" : "saved");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setSends((n) => n + 1);
    }
  }

  return (
    <div>
      <PublicSiteHeader plain title={survey?.title || "Survey"} />
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
            <SurveyQuestions
              questions={survey.questions}
              answers={answers}
              onChange={change}
              disabled={busy}
              onPhoto={sendPhoto}
              photos={photos}
              supportMenu={survey.supportMenu}
            />
            {/* Where the person is looking after pressing a button, not above the questions. */}
            <div ref={resultRef}>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {!error && state === "done" && (
                <p role="status" style={{ color: "var(--accent)" }}>
                  Thank you, your answers are in. You can change them below until the survey closes.
                </p>
              )}
              {!error && state === "saved" && skipped.length === 0 && (
                <p role="status" style={{ color: "var(--accent)" }}>
                  Saved. You can come back to this same link to finish later.
                </p>
              )}
              {!error && skipped.length > 0 && (
                <div role="alert" className="form-error">
                  <p style={{ margin: "0 0 0.25rem" }}>
                    {state === "done" ? "Your answers are in, except for these" : "Saved, except for these"}:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                    {skipped.map((item) => (
                      <li key={item.questionId}>
                        <strong>{item.label}</strong>: {item.error}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "0.25rem 0 0" }}>Please fix them and save again.</p>
                </div>
              )}
            </div>
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

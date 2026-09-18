import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner } from "../components/Feedback";
import { ConfirmModal } from "../components/ConfirmModal";

interface Question {
  id: string;
  session_id: string;
  concept_id: string;
  difficulty: string;
  kind: "mcq" | "open_ended";
  question_text: string;
  options: string[] | null;
  expected_key_points: string[] | null;
  selection_score: number | null;
  selection_reasons: Record<string, unknown> | null;
}

interface AnswerResult {
  id: string;
  is_correct: boolean | null;
  understanding_level: string | null;
  accuracy: string | null;
  relevance: string | null;
  concepts_covered: string[];
  concepts_missing: string[];
  grading_explanation: string | null;
  how_to_improve: string | null;
  correct_answer: string | null;
}

interface QuizSession {
  id: string;
  project_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

interface ConceptStat {
  concept_id: string;
  concept_name: string;
  questions: number;
  correct: number;
}

interface QuizSessionSummary {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  questions_generated: number;
  questions_answered: number;
  correct_count: number;
  accuracy: number | null;
  concepts_practiced: ConceptStat[];
}

interface HistoryEntry {
  question: Question;
  result: AnswerResult | null;
}

type Tone = "good" | "mid" | "bad";

const TONE_STYLES: Record<Tone, { background: string; color: string }> = {
  good: { background: "var(--green-tint)", color: "#0a8a5a" },
  mid: { background: "var(--amber-tint)", color: "#a5620a" },
  bad: { background: "var(--red-tint)", color: "#c81e46" },
};

const TONE_MAP: Record<"understanding" | "accuracy" | "relevance", Record<string, Tone>> = {
  understanding: { strong: "good", partial: "mid", weak: "bad" },
  accuracy: { accurate: "good", partially_accurate: "mid", inaccurate: "bad" },
  relevance: { relevant: "good", partially_relevant: "mid", off_topic: "bad" },
};

function toneStyle(tone: Tone | undefined) {
  return TONE_STYLES[tone ?? "bad"];
}

export default function QuizPage() {
  const { projectId } = useParams();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string>("");
  const [openAnswer, setOpenAnswer] = useState("");
  const [summary, setSummary] = useState<QuizSessionSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [grading, setGrading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [pastSessions, setPastSessions] = useState<QuizSessionSummary[]>([]);
  const submittingRef = useRef(false);

  const current = history[index];

  async function loadHistory() {
    if (!projectId) return;
    try {
      const list = await api.get<QuizSessionSummary[]>(`/api/projects/${projectId}/quiz/sessions`);
      setPastSessions(list);
    } catch (err) {
      // The backend returns an empty list (not an error) when there's no
      // quiz history yet, so a caught error here is a real failure — past
      // sessions just won't show below, but the user should know why.
      setError(err instanceof ApiError ? err.message : "Could not load your past quiz sessions.");
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function generateQuestion(sessionId: string, baseHistoryLength: number) {
    setError(null);
    setSelected("");
    setOpenAnswer("");
    setShowWhy(false);
    setShowHint(false);
    setLoadingQuestion(true);
    try {
      const q = await api.post<Question>(`/api/projects/${projectId}/quiz/sessions/${sessionId}/generate`, {});
      setHistory((h) => [...h, { question: q, result: null }]);
      setIndex(baseHistoryLength);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a question right now.");
    } finally {
      setLoadingQuestion(false);
    }
  }

  async function startQuiz() {
    if (!projectId) return;
    setError(null);
    setStarting(true);
    try {
      const s = await api.post<QuizSession>(`/api/projects/${projectId}/quiz/sessions`, {});
      setSession(s);
      await generateQuestion(s.id, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start a quiz right now.");
    } finally {
      setStarting(false);
    }
  }

  async function submitAnswer() {
    if (!projectId || !session || !current || current.result || submittingRef.current) return;
    const answerText = current.question.kind === "mcq" ? selected : openAnswer;
    if (!answerText.trim()) return;

    submittingRef.current = true;
    setError(null);
    setGrading(true);
    try {
      const res = await api.post<AnswerResult>(
        `/api/projects/${projectId}/quiz/sessions/${session.id}/answer`,
        { question_id: current.question.id, answer_text: answerText }
      );
      const answeredIndex = index;
      setHistory((h) => h.map((item, i) => (i === answeredIndex ? { ...item, result: res } : item)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not grade your answer right now.");
    } finally {
      setGrading(false);
      submittingRef.current = false;
    }
  }

  function goToPrevious() {
    if (index === 0) return;
    setError(null);
    setShowWhy(false);
    setShowHint(false);
    setIndex((i) => i - 1);
  }

  async function goToNext() {
    if (!session) return;
    setError(null);
    setShowWhy(false);
    setShowHint(false);
    if (index < history.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    if (current?.result) {
      await generateQuestion(session.id, history.length);
    }
  }

  async function finishQuiz() {
    if (!projectId || !session) return;
    setConfirmingEnd(false);
    setError(null);
    setFinishing(true);
    try {
      const s = await api.post<QuizSessionSummary>(`/api/projects/${projectId}/quiz/sessions/${session.id}/complete`, {});
      setSummary(s);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not finish the quiz right now.");
    } finally {
      setFinishing(false);
    }
  }

  function startNewQuiz() {
    setSession(null);
    setHistory([]);
    setIndex(0);
    setSummary(null);
    setError(null);
  }

  const canGoNext = index < history.length - 1 || !!current?.result;
  const answeredCount = history.filter((h) => h.result).length;

  return (
    <div className="page">
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20 }}>Quiz</h1>

      {error && <ErrorBanner message={error} />}

      {!session && !starting && !summary && (
        <>
          <div className="quiz-start" style={{ marginBottom: 24 }}>
            <p>Generate an adaptive quiz based on your current mastery, recent mistakes, and practice history.</p>
            <button className="btn" onClick={startQuiz}>Start Quiz</button>
          </div>

          {pastSessions.length > 0 && (
            <div className="block">
              <div className="section-label" style={{ padding: "20px 22px 4px" }}>Quiz History</div>
              <div>
                {pastSessions.map((s) => (
                  <div key={s.id} className="qh-row">
                    <div>
                      <div className="qh-when">{new Date(s.started_at).toLocaleString()}</div>
                      <div className="qh-meta">
                        {s.status === "completed"
                          ? `${s.questions_answered} question${s.questions_answered === 1 ? "" : "s"} answered${
                              s.concepts_practiced.length > 0
                                ? ` · ${s.concepts_practiced.length} concept${s.concepts_practiced.length === 1 ? "" : "s"}`
                                : ""
                            }`
                          : "Not finished"}
                      </div>
                    </div>
                    {s.status === "completed" ? (
                      <span
                        className={`badge ${
                          s.accuracy !== null && s.accuracy >= 0.7
                            ? "b-green"
                            : s.accuracy !== null && s.accuracy >= 0.4
                            ? "b-amber"
                            : "b-red"
                        }`}
                      >
                        {s.accuracy !== null ? `${Math.round(s.accuracy * 100)}% correct` : "No answers"}
                      </span>
                    ) : (
                      <span className="badge b-muted">In progress</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {starting && <div style={{ color: "var(--muted)" }}>Starting quiz…</div>}

      {session && !summary && loadingQuestion && <div style={{ color: "var(--muted)" }}>Generating a grounded question…</div>}

      {session && !summary && current && !loadingQuestion && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <span className="badge b-muted">{current.question.difficulty}</span>
              <span className="badge b-muted">
                {current.question.kind === "mcq" ? "Multiple choice" : "Open-ended"}
              </span>
            </div>
            <span style={{ color: "var(--faint)", fontSize: 13 }}>Question {index + 1} of {history.length}</span>
          </div>

          <p style={{ fontSize: 17, marginBottom: 16, fontWeight: 600 }}>{current.question.question_text}</p>

          {!current.result && current.question.kind === "mcq" && current.question.options && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {current.question.options.map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "12px 14px",
                    background: selected === opt ? "var(--violet-tint)" : "var(--surface-2)",
                    border: `1.5px solid ${selected === opt ? "var(--violet)" : "transparent"}`,
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  <input type="radio" name="mcq" value={opt} checked={selected === opt} onChange={() => setSelected(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          )}

          {!current.result && current.question.kind === "open_ended" && (
            <textarea
              rows={5}
              style={{ width: "100%", marginBottom: 16 }}
              placeholder="Type your answer…"
              value={openAnswer}
              onChange={(e) => setOpenAnswer(e.target.value)}
            />
          )}

          {!current.result && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={submitAnswer} disabled={grading}>
                {grading ? "Grading…" : "Submit Answer"}
              </button>
              {current.question.kind === "open_ended" &&
                current.question.expected_key_points &&
                current.question.expected_key_points.length > 0 && (
                  <button className="btn btn-ghost" type="button" onClick={() => setShowHint((s) => !s)}>
                    {showHint ? "Hide hint" : "Not sure? Show a hint"}
                  </button>
                )}
              {current.question.selection_reasons && (
                <button className="btn btn-ghost" type="button" onClick={() => setShowWhy((s) => !s)}>
                  {showWhy ? "Hide" : "Why this question?"}
                </button>
              )}
            </div>
          )}
          {showHint && current.question.expected_key_points && (
            <div style={{ marginTop: -8, marginBottom: 16, fontSize: 13.5, color: "var(--muted)" }}>
              <div style={{ marginBottom: 4 }}>A strong answer would cover:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {current.question.expected_key_points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}
          {showWhy && current.question.selection_reasons && (
            <pre style={{ marginTop: -8, marginBottom: 16, whiteSpace: "pre-wrap", fontSize: 12, color: "var(--muted)", background: "var(--surface-2)", padding: 12, borderRadius: "var(--radius-sm)" }}>
              {JSON.stringify(current.question.selection_reasons, null, 2)}
            </pre>
          )}

          {current.result && (
            <div style={{ marginBottom: 16 }}>
              {current.question.kind === "mcq" ? (
                <>
                  <div
                    className="h-disp"
                    style={{
                      fontSize: 20,
                      color: current.result.is_correct ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {current.result.is_correct ? "Correct!" : "Incorrect"}
                  </div>
                  {!current.result.is_correct && (
                    <p style={{ color: "var(--muted)" }}>Correct answer: {current.result.correct_answer}</p>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    <span className="badge" style={toneStyle(TONE_MAP.understanding[current.result.understanding_level ?? ""])}>
                      {current.result.understanding_level} understanding
                    </span>
                    {current.result.accuracy && (
                      <span className="badge" style={toneStyle(TONE_MAP.accuracy[current.result.accuracy])}>
                        {current.result.accuracy.replace("_", " ")}
                      </span>
                    )}
                    {current.result.relevance && (
                      <span className="badge" style={toneStyle(TONE_MAP.relevance[current.result.relevance])}>
                        {current.result.relevance.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  {current.result.grading_explanation && <p>{current.result.grading_explanation}</p>}
                  {current.result.concepts_covered.length > 0 && (
                    <p style={{ marginTop: 10, color: "var(--muted)" }}>
                      <strong style={{ color: "var(--ink)" }}>What you understood:</strong> {current.result.concepts_covered.join(", ")}
                    </p>
                  )}
                  {current.result.concepts_missing.length > 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      <strong style={{ color: "var(--ink)" }}>What is missing:</strong> {current.result.concepts_missing.join(", ")}
                    </p>
                  )}
                  {current.result.how_to_improve && (
                    <p style={{ color: "var(--muted)" }}>
                      <strong style={{ color: "var(--ink)" }}>How to improve:</strong> {current.result.how_to_improve}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div
            className="spread"
            style={{
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              {index > 0 && (
                <button className="btn btn-ghost" onClick={goToPrevious}>
                  ← Previous Question
                </button>
              )}
              <button className="btn btn-ghost" onClick={goToNext} disabled={!canGoNext || loadingQuestion}>
                Next Question →
              </button>
            </div>
            <button className="btn btn-ghost" onClick={() => setConfirmingEnd(true)} disabled={finishing}>
              {finishing ? "Ending…" : "End Quiz"}
            </button>
          </div>
        </div>
      )}

      {confirmingEnd && (
        <ConfirmModal
          title="End this quiz?"
          message={`You've answered ${answeredCount} of ${history.length} question${history.length === 1 ? "" : "s"} so far. Ending now saves your results and closes this session.`}
          confirmLabel="End Quiz"
          onConfirm={finishQuiz}
          onCancel={() => setConfirmingEnd(false)}
        />
      )}

      {summary && (
        <div className="card">
          <h2 className="h-disp" style={{ fontSize: 22, marginBottom: 18 }}>Quiz Complete 🎉</h2>
          <div className="kpis c3" style={{ marginBottom: 20 }}>
            <div className="kpi">
              <div className="k-label">Questions answered</div>
              <div className="k-val">{summary.questions_answered}</div>
            </div>
            <div className="kpi">
              <div className="k-label">Correct answers</div>
              <div className="k-val">{summary.correct_count}</div>
            </div>
            <div className="kpi grad v">
              <div className="k-label">Performance</div>
              <div className="k-val">
                {summary.accuracy !== null ? `${Math.round(summary.accuracy * 100)}%` : "—"}
              </div>
            </div>
          </div>

          {summary.concepts_practiced.length > 0 && (
            <>
              <div className="section-label" style={{ marginBottom: 10 }}>Concepts Practiced</div>
              <div style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
                {summary.concepts_practiced.map((c) => (
                  <div key={c.concept_id} className="act-row">
                    <span className="what">{c.concept_name}</span>
                    <span className="when">{c.correct}/{c.questions} correct</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={startNewQuiz}>Start New Quiz</button>
            <Link className="btn btn-ghost" to={`/projects/${projectId}`}>Back to Project</Link>
          </div>
        </div>
      )}
    </div>
  );
}

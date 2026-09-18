import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState } from "../components/Feedback";

interface Flashcard {
  id: string;
  concept_id: string;
  front: string;
  back: string;
  source_material_name: string | null;
  source_page_number: number | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
}

type Grade = "again" | "hard" | "good" | "easy";

const GRADE_LABEL: Record<Grade, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

const GRADE_CLASS: Record<Grade, string> = {
  again: "g-again",
  hard: "g-hard",
  good: "g-good",
  easy: "g-easy",
};

export default function FlashcardsPage() {
  const { projectId } = useParams();
  const [dueCards, setDueCards] = useState<Flashcard[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);

  function load() {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      api.get<Flashcard[]>(`/api/projects/${projectId}/flashcards?due_only=true`),
      api.get<Flashcard[]>(`/api/projects/${projectId}/flashcards`),
    ])
      .then(([due, all]) => {
        setDueCards(due);
        setTotalCount(all.length);
        setIndex(0);
        setRevealed(false);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load flashcards."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function generate() {
    if (!projectId) return;
    setError(null);
    setGenerating(true);
    try {
      await api.post(`/api/projects/${projectId}/flashcards/generate`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate flashcards.");
    } finally {
      setGenerating(false);
    }
  }

  async function grade(g: Grade) {
    if (!projectId) return;
    const card = dueCards[index];
    if (!card) return;
    try {
      await api.post(`/api/projects/${projectId}/flashcards/${card.id}/review`, { grade: g });
      setReviewedCount((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record review.");
    }
  }

  if (!projectId) return null;

  const current = dueCards[index];
  const sessionDone = dueCards.length > 0 && index >= dueCards.length;

  const progressPct = totalCount && totalCount > 0 ? Math.round((index / Math.max(1, dueCards.length)) * 100) : 0;

  return (
    <div className="page">
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20, textAlign: "center" }}>Flashcards</h1>

      {error && <ErrorBanner message={error} />}

      {loading && <div style={{ color: "var(--muted)", textAlign: "center" }}>Loading…</div>}

      {!loading && totalCount === 0 && (
        <div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
          <EmptyState
            title="No flashcards yet"
            hint="Generate flashcards from your Project's concepts to start spaced-repetition review."
          />
          <div style={{ textAlign: "center" }}>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={generate} disabled={generating}>
              {generating ? "Generating…" : "Generate flashcards"}
            </button>
          </div>
        </div>
      )}

      {!loading && totalCount !== null && totalCount > 0 && dueCards.length === 0 && !sessionDone && (
        <div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
          <EmptyState title="Nothing due for review right now" hint={`You have ${totalCount} flashcard${totalCount === 1 ? "" : "s"} total — check back later, or add more.`} />
          <div style={{ textAlign: "center" }}>
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={generate} disabled={generating}>
              {generating ? "Generating…" : "Generate more (new concepts)"}
            </button>
          </div>
        </div>
      )}

      {sessionDone && (
        <div className="card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div className="h-disp" style={{ fontSize: 20, marginBottom: 6 }}>Review session complete 🎉</div>
          <div style={{ color: "var(--muted)" }}>You reviewed {reviewedCount} card{reviewedCount === 1 ? "" : "s"}.</div>
        </div>
      )}

      {current && !sessionDone && (
        <div className="fc">
          <div className="fc-card">
            <div className="fc-count">CARD {index + 1} OF {dueCards.length}</div>
            <div className="fc-q">{current.front}</div>
            {revealed && (
              <div className="fc-a" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                {current.back}
                {current.source_material_name && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--faint)" }}>
                    Source: {current.source_material_name}
                    {current.source_page_number ? ` — Page ${current.source_page_number}` : ""}
                  </div>
                )}
              </div>
            )}

            {!revealed ? (
              <button className="btn btn-primary" style={{ marginTop: 22, width: "100%" }} onClick={() => setRevealed(true)}>
                Show answer
              </button>
            ) : (
              <div className="fc-grade">
                {(Object.keys(GRADE_LABEL) as Grade[]).map((g) => (
                  <button key={g} className={`grade ${GRADE_CLASS[g]}`} onClick={() => grade(g)}>
                    {GRADE_LABEL[g]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="fc-progress">
            <i style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, LoadingBlock, EmptyState } from "../components/Feedback";
import NewSpaceProjectForm from "../components/NewSpaceProjectForm";
import { Ring } from "../components/Charts";

interface HomeData {
  recent_projects: { id: string; name: string; space_id: string; space_name: string }[];
  spaces: { id: string; name: string; description: string; project_count: number }[];
  overall_progress: { average_mastery: number | null; tracked_concepts: number };
  areas_requiring_attention: { concept_id: string; concept_name: string; project_id: string; mastery: number }[];
  recommended_next_action: { action_text: string; project_id: string } | null;
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  function load() {
    setError(null);
    api
      .get<HomeData>("/api/home")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your dashboard."));
  }

  useEffect(load, []);

  return (
    <div className="page">
      <div className="page-head" style={{ padding: "0 0 4px" }}>
        <span className="kicker">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">space_dashboard</span>
          Dashboard
        </span>
        <h1 className="title" style={{ fontSize: "clamp(28px,4vw,40px)", marginTop: 12 }}>Home</h1>
        <p className="subtitle">Your learning at a glance.</p>
      </div>

      {error && <ErrorBanner message={error} />}
      {!data && !error && (
        <div className="card" style={{ marginTop: 20 }}>
          <LoadingBlock lines={4} />
        </div>
      )}

      {data && (
        <div className="stack-g reveal" style={{ marginTop: 24 }}>
          <div className="hero">
            <div className="next">
              <span className="tag">
                <span className="pd" aria-hidden="true" />
                Recommended next
              </span>
              {data.recommended_next_action ? (
                <>
                  <h2>{data.recommended_next_action.action_text}</h2>
                  <div className="actions">
                    <Link className="btn btn-primary" to={`/projects/${data.recommended_next_action.project_id}`}>
                      Go to Project
                    </Link>
                    <button className="btn btn-ghost" onClick={() => setShowExplain((s) => !s)}>
                      {showExplain ? "Hide" : "Why this recommendation?"}
                    </button>
                  </div>
                  {showExplain && (
                    <p style={{ marginTop: 14, fontSize: 13.5, opacity: 0.9, position: "relative", maxWidth: "48ch" }}>
                      This is generated from your recent quiz activity — concept mastery trends, repeated mistakes,
                      and your stated Project goal — the same signals shown in that Project's Analytics tab. See the
                      Activity Timeline there for the exact events behind this recommendation.
                    </p>
                  )}
                </>
              ) : (
                <h2>Upload a material and start a Project to get a personalized recommendation here.</h2>
              )}
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <div className="section-label">Average mastery</div>
              <Ring value={data.overall_progress.average_mastery ?? 0} />
              <div style={{ fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
                {data.overall_progress.tracked_concepts} concept{data.overall_progress.tracked_concepts === 1 ? "" : "s"} tracked
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-label">Needs attention</div>
            {data.areas_requiring_attention.length === 0 ? (
              <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 14 }}>Nothing flagged right now — nice work.</div>
            ) : (
              <div className="bars">
                {data.areas_requiring_attention.slice(0, 6).map((a) => {
                  const pct = Math.round(a.mastery * 100);
                  return (
                    <div className="bar" key={a.concept_id}>
                      <Link to={`/projects/${a.project_id}`} className="name" style={{ color: "var(--ink)" }}>
                        {a.concept_name}
                      </Link>
                      <span className="pct">{pct}%</span>
                      <div className="track">
                        <div
                          className="fill"
                          style={{
                            width: `${pct}%`,
                            background: pct < 40 ? "var(--grad-amber)" : "var(--grad)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="spread" style={{ marginBottom: 16 }}>
              <div className="section-label">Your Spaces</div>
              <NewSpaceProjectForm onCreated={load} />
            </div>
            {data.spaces.length === 0 ? (
              <EmptyState title="No Spaces yet" hint="A Space groups related Projects together — create one to get started." />
            ) : (
              <div className="grid-sp">
                {data.spaces.map((s) => (
                  <div key={s.id} className="space">
                    <div className="name">{s.name}</div>
                    {s.description && <div className="count">{s.description}</div>}
                    <div className="count">
                      {s.project_count} Project{s.project_count === 1 ? "" : "s"}
                    </div>
                    <Link className="link" to={`/spaces/${s.id}`} style={{ marginTop: 14 }}>
                      Open Space <span className="arw">→</span>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-label" style={{ marginBottom: 14 }}>Recent Projects</div>
            {data.recent_projects.length === 0 ? (
              <EmptyState title="No Projects yet" hint="Create a Space and Project to upload material and start learning." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {data.recent_projects.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="act-row" style={{ color: "var(--ink)" }}>
                    <span className="what">{p.name}</span>
                    {p.space_name && <span className="when">in {p.space_name}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

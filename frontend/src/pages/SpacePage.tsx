import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { ConfirmModal } from "../components/ConfirmModal";

interface SpaceProject {
  id: string;
  name: string;
  description: string;
  goal: string;
  created_at: string;
}

interface SpaceActivityItem {
  type: string;
  project_id: string;
  created_at: string;
}

interface AreaNeedingAttention {
  concept_id: string;
  concept_name: string;
  project_id: string;
  project_name: string;
  mastery: number;
}

interface SpaceAnalytics {
  space: { id: string; name: string; description: string };
  projects: SpaceProject[];
  recent_activity: SpaceActivityItem[];
  overall_progress: { average_mastery: number | null; tracked_concepts: number; project_count: number };
  areas_requiring_attention: AreaNeedingAttention[];
}

export default function SpacePage() {
  const { spaceId } = useParams();
  const [data, setData] = useState<SpaceAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState<SpaceProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    if (!spaceId) return;
    setError(null);
    api
      .get<SpaceAnalytics>(`/api/spaces/${spaceId}/analytics`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this Space."));
  }

  useEffect(load, [spaceId]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!spaceId || !projectName.trim()) return;
    setCreating(true);
    try {
      await api.post(`/api/spaces/${spaceId}/projects`, { name: projectName, description, goal });
      setProjectName("");
      setDescription("");
      setGoal("");
      setShowNewProject(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create Project.");
    } finally {
      setCreating(false);
    }
  }

  async function confirmDeleteProject() {
    if (!spaceId || !deletingProject) return;
    setDeleting(true);
    try {
      await api.del(`/api/spaces/${spaceId}/projects/${deletingProject.id}`);
      setDeletingProject(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete Project.");
    } finally {
      setDeleting(false);
    }
  }

  if (!spaceId) return null;

  return (
    <div className="page">
      <div className="crumb">
        <Link to="/" style={{ color: "inherit" }}>← Home</Link>
      </div>
      <h1 className="title" style={{ fontSize: "clamp(26px,4vw,36px)" }}>{data?.space.name ?? "Space"}</h1>
      {data?.space.description && <p className="subtitle">{data.space.description}</p>}

      {error && <ErrorBanner message={error} />}
      {!data && !error && (
        <div className="card" style={{ marginTop: 20 }}>
          <LoadingBlock lines={4} />
        </div>
      )}

      {data && (
        <div className="stack-g" style={{ marginTop: 24 }}>
          <div className="kpis c3">
            <div className="kpi grad v">
              <div className="k-ico">📊</div>
              <div className="k-label">Average mastery</div>
              <div className="k-val">
                {data.overall_progress.average_mastery !== null
                  ? `${Math.round(data.overall_progress.average_mastery * 100)}%`
                  : "—"}
              </div>
              <div className="k-sub">
                {data.overall_progress.tracked_concepts} concepts across {data.overall_progress.project_count} Project
                {data.overall_progress.project_count === 1 ? "" : "s"}
              </div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-a">⚠️</div>
              <div className="k-label">Needs attention</div>
              <div className="k-val">{data.areas_requiring_attention.length}</div>
              <div className="k-sub">concept{data.areas_requiring_attention.length === 1 ? "" : "s"} flagged</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-v">📁</div>
              <div className="k-label">Projects</div>
              <div className="k-val">{data.projects.length}</div>
              <div className="k-sub">in this Space</div>
            </div>
          </div>

          {data.areas_requiring_attention.length > 0 && (
            <div className="card">
              <div className="section-label">Needs attention</div>
              <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
                {data.areas_requiring_attention.slice(0, 4).map((a) => (
                  <li key={a.concept_id} style={{ marginBottom: 6 }}>
                    <Link to={`/projects/${a.project_id}`}>{a.concept_name}</Link>{" "}
                    <span style={{ color: "var(--faint)", fontSize: 13 }}>
                      ({Math.round(a.mastery * 100)}% — {a.project_name})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="spread" style={{ marginBottom: 16 }}>
              <div className="section-label">Projects</div>
              <button className="newbtn" onClick={() => setShowNewProject((s) => !s)}>
                + New Project
              </button>
            </div>

            {showNewProject && (
              <form
                onSubmit={createProject}
                style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, padding: 18, background: "var(--surface-2)", borderRadius: "var(--radius-sm)" }}
              >
                <input
                  placeholder="Project name (required)"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <input
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <input
                  placeholder="Learning goal (optional)"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowNewProject(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {data.projects.length === 0 ? (
              <EmptyState title="No Projects yet" hint="Create a Project to upload material and start learning." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {data.projects.map((p) => (
                  <div key={p.id} className="act-row">
                    <Link to={`/projects/${p.id}`} style={{ display: "block", flex: 1, color: "var(--ink)", minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      {p.description && <div style={{ color: "var(--muted)", fontSize: 13 }}>{p.description}</div>}
                      {p.goal && <div style={{ color: "var(--muted)", fontSize: 13 }}>Goal: {p.goal}</div>}
                    </Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeletingProject(p);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-label" style={{ marginBottom: 12 }}>Recent Activity</div>
            {data.recent_activity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {data.recent_activity.map((item, i) => (
                  <div key={i} className="act-row">
                    <span className="what">{item.type.replace(/_/g, " ")}</span>
                    <span className="when">{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {deletingProject && (
        <ConfirmModal
          title="Delete Project?"
          message={`"${deletingProject.name}" and everything in it — materials, quizzes, and progress — will be permanently deleted.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          onConfirm={confirmDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}
    </div>
  );
}

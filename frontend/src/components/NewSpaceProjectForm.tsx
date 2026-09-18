import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";

interface Space {
  id: string;
  name: string;
}

const NEW_SPACE_VALUE = "__new__";

export default function NewSpaceProjectForm({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  // Every submit used to call POST /api/spaces unconditionally, so creating
  // two Projects from Home (even leaving the name blank both times, which
  // defaulted to "My Space") silently created two separate Space rows with
  // the same name. Picking an existing Space is now the default; creating a
  // new one is an explicit choice.
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(NEW_SPACE_VALUE);
  const [spaceName, setSpaceName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<Space[]>("/api/spaces")
      .then((list) => {
        setSpaces(list);
        if (list.length > 0) setSelectedSpaceId(list[0].id);
      })
      .catch(() => {
        // Fall back to "create new Space" if the list can't be loaded — not fatal.
      });
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let spaceId = selectedSpaceId;
      if (spaceId === NEW_SPACE_VALUE) {
        const space = await api.post<Space>("/api/spaces", { name: spaceName || "My Space" });
        spaceId = space.id;
      }
      const project = await api.post<{ id: string }>(`/api/spaces/${spaceId}/projects`, {
        name: projectName,
        description,
        goal,
      });
      onCreated();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create Project.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="newbtn" onClick={() => setOpen(true)}>
        + New Project
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360, padding: 18, background: "var(--surface-2)", borderRadius: "var(--radius-sm)" }}
    >
      {error && <div className="error-banner">{error}</div>}

      <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
        Space
        <select
          value={selectedSpaceId}
          onChange={(e) => setSelectedSpaceId(e.target.value)}
          style={{ width: "100%", marginTop: 4 }}
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={NEW_SPACE_VALUE}>+ Create new Space…</option>
        </select>
      </label>

      {selectedSpaceId === NEW_SPACE_VALUE && (
        <input placeholder="New Space name (e.g. Semester 1)" value={spaceName} onChange={(e) => setSpaceName(e.target.value)} />
      )}

      <input placeholder="Project name (required)" required value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input placeholder="Learning goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

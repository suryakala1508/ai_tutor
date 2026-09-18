import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpacePage from "./SpacePage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderAt(spaceId: string) {
  return render(
    <MemoryRouter initialEntries={[`/spaces/${spaceId}`]}>
      <Routes>
        <Route path="/spaces/:spaceId" element={<SpacePage />} />
      </Routes>
    </MemoryRouter>
  );
}

const BASE = {
  recent_activity: [],
  overall_progress: { average_mastery: null, tracked_concepts: 0, project_count: 2 },
  areas_requiring_attention: [],
};

describe("SpacePage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the real Space name and description, not a generic placeholder", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE,
      space: { id: "s1", name: "Interview Preparation", description: "Prepare for software engineering interviews." },
      projects: [],
    });

    renderAt("s1");

    expect(await screen.findByText("Interview Preparation")).toBeInTheDocument();
    expect(screen.getByText("Prepare for software engineering interviews.")).toBeInTheDocument();
  });

  it("lists the Projects that belong to this Space", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE,
      space: { id: "s1", name: "Interview Preparation", description: "" },
      projects: [
        { id: "p1", name: "Python Interview", description: "", goal: "", created_at: new Date().toISOString() },
        { id: "p2", name: "DSA Preparation", description: "", goal: "", created_at: new Date().toISOString() },
      ],
    });

    renderAt("s1");

    expect(await screen.findByText("Python Interview")).toBeInTheDocument();
    expect(screen.getByText("DSA Preparation")).toBeInTheDocument();
  });

  it("creating a Project posts to this Space's URL, not a client-chosen space_id", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE,
      space: { id: "s1", name: "Interview Preparation", description: "" },
      projects: [],
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "new-project" });

    renderAt("s1");
    await screen.findByText("Interview Preparation");

    await userEvent.click(screen.getByText("+ New Project"));
    await userEvent.type(screen.getByPlaceholderText("Project name (required)"), "AI Engineer Interview");
    await userEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/spaces/s1/projects", {
        name: "AI Engineer Interview",
        description: "",
        goal: "",
      })
    );
  });
});

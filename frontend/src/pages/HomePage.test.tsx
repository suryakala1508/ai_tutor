import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./HomePage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), postForm: vi.fn(), del: vi.fn() } };
});

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

const BASE_HOME_DATA = {
  overall_progress: { average_mastery: null, tracked_concepts: 0 },
  areas_requiring_attention: [],
  recommended_next_action: null,
};

describe("HomePage spaces/projects hierarchy display", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows each Space once, with its description and project count", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_HOME_DATA,
      recent_projects: [],
      spaces: [
        { id: "s1", name: "Interview Prep", description: "Get ready for interviews", project_count: 3 },
        { id: "s2", name: "DSA", description: "", project_count: 0 },
      ],
    });

    renderHome();

    expect(await screen.findByText("Interview Prep")).toBeInTheDocument();
    expect(screen.getByText("Get ready for interviews")).toBeInTheDocument();
    expect(screen.getByText("3 Projects")).toBeInTheDocument();
    expect(screen.getByText("DSA")).toBeInTheDocument();
    expect(screen.getByText("0 Projects")).toBeInTheDocument();
    // exactly one card per Space — the regression this feature is fixing
    expect(screen.getAllByText("Interview Prep")).toHaveLength(1);
  });

  it("labels each recent project with its parent Space", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_HOME_DATA,
      recent_projects: [{ id: "p1", name: "Python Interview", space_id: "s1", space_name: "Interview Prep" }],
      spaces: [],
    });

    renderHome();

    expect(await screen.findByText("Python Interview")).toBeInTheDocument();
    expect(screen.getByText("in Interview Prep")).toBeInTheDocument();
  });

  it("shows empty states when there are no Spaces or Projects yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ...BASE_HOME_DATA, recent_projects: [], spaces: [] });

    renderHome();

    expect(await screen.findByText("No Spaces yet")).toBeInTheDocument();
    expect(screen.getByText("No Projects yet")).toBeInTheDocument();
  });
});

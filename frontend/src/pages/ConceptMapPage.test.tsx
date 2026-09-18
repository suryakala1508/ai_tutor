import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConceptMapPage from "./ConceptMapPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/concept-map`]}>
      <Routes>
        <Route path="/projects/:projectId/concept-map" element={<ConceptMapPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ConceptMapPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the empty state when there are no concepts yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ nodes: [], edges: [] });

    renderAt("p1");

    expect(await screen.findByText("No concepts yet")).toBeInTheDocument();
  });

  it("renders a labeled node for each concept returned by the API", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: [
        { concept_id: "a", name: "Recursion", mastery: 0.8, trend: "improving", attempts: 5 },
        { concept_id: "b", name: "Base Case", mastery: 0.3, trend: "needs-attention", attempts: 2 },
      ],
      edges: [{ source: "a", target: "b", weight: 2 }],
    });

    renderAt("p2");

    expect(await screen.findByText("Recursion")).toBeInTheDocument();
    expect(await screen.findByText("Base Case")).toBeInTheDocument();
  });
});

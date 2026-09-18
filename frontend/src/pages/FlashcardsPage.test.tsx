import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlashcardsPage from "./FlashcardsPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), postForm: vi.fn(), del: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/flashcards`]}>
      <Routes>
        <Route path="/projects/:projectId/flashcards" element={<FlashcardsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlashcardsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers to generate flashcards when there are none yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderAt("p1");

    expect(await screen.findByText("No flashcards yet")).toBeInTheDocument();
    expect(screen.getByText("Generate flashcards")).toBeInTheDocument();
  });

  it("shows a due card, reveals the answer, and submits a review grade", async () => {
    const dueCard = {
      id: "c1",
      concept_id: "concept-1",
      front: "What is a closure?",
      back: "A function bundled with its lexical scope.",
      source_material_name: "Notes.pdf",
      source_page_number: 3,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      next_review_at: new Date().toISOString(),
    };
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.includes("due_only") ? [dueCard] : [dueCard])
    );
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ ...dueCard, repetitions: 1 });

    renderAt("p2");

    expect(await screen.findByText("What is a closure?")).toBeInTheDocument();
    expect(screen.queryByText(/lexical scope/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Show answer"));
    expect(await screen.findByText(/lexical scope/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Good"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/api/projects/p2/flashcards/${dueCard.id}/review`, { grade: "good" })
    );
    expect(await screen.findByText(/Review session complete/)).toBeInTheDocument();
  });
});

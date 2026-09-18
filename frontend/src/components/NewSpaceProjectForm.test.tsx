import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewSpaceProjectForm from "./NewSpaceProjectForm";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderForm(onCreated = vi.fn()) {
  return render(
    <MemoryRouter>
      <NewSpaceProjectForm onCreated={onCreated} />
    </MemoryRouter>
  );
}

describe("NewSpaceProjectForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults to an existing Space and does NOT call POST /api/spaces when one is selected", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "s1", name: "Interview Prep" }]);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "new-project" });

    renderForm();

    await userEvent.click(screen.getByText("+ New Project"));
    await waitFor(() => expect(screen.getByText("Interview Prep")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Project name (required)"), "Python Interview");
    await userEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/spaces/s1/projects", {
        name: "Python Interview",
        description: "",
        goal: "",
      })
    );
    // this is the regression check: no new Space was created for an existing pick
    expect(api.post).not.toHaveBeenCalledWith("/api/spaces", expect.anything());
  });

  it("creating two Projects from Home with an existing Space selected reuses that Space both times", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "s1", name: "Interview Prep" }]);
    (api.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.includes("/projects") ? { id: "p-" + Math.random() } : { id: "s1", name: "Interview Prep" })
    );
    const onCreated = vi.fn();

    const { unmount } = renderForm(onCreated);
    await userEvent.click(screen.getByText("+ New Project"));
    await waitFor(() => expect(screen.getByText("Interview Prep")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("Project name (required)"), "Project One");
    await userEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    unmount();

    renderForm(onCreated);
    await userEvent.click(screen.getByText("+ New Project"));
    await waitFor(() => expect(screen.getByText("Interview Prep")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("Project name (required)"), "Project Two");
    await userEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));

    // both project creations targeted the same existing Space — never a fresh POST /api/spaces
    expect(api.post).not.toHaveBeenCalledWith("/api/spaces", expect.anything());
  });

  it("creates a new Space only when the user explicitly chooses to", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path === "/api/spaces" ? { id: "s-new", name: "New Semester" } : { id: "p1" })
    );

    renderForm();

    await userEvent.click(screen.getByText("+ New Project"));
    await waitFor(() => expect(screen.getByPlaceholderText(/New Space name/)).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText(/New Space name/), "New Semester");
    await userEvent.type(screen.getByPlaceholderText("Project name (required)"), "Kickoff Project");
    await userEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/spaces", { name: "New Semester" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/spaces/s-new/projects", {
        name: "Kickoff Project",
        description: "",
        goal: "",
      })
    );
  });
});

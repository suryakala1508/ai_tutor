import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

function Probe() {
  const { user, loading, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email : "none"}</div>
      <div data-testid="is-admin">{user ? String(user.is_admin) : "none"}</div>
      <button onClick={() => login("student@test.com", "password123")}>login</button>
      <button onClick={logout}>logout</button>
      <button onClick={() => refreshUser()}>refresh</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts logged out with no token and stops loading", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("logging in stores the token and exposes the authenticated user", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "tok-abc", user_id: "u1", email: "student@test.com", is_admin: false }),
        { status: 200 }
      )
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("student@test.com"));
    expect(localStorage.getItem("token")).toBe("tok-abc");
  });

  it("logging out clears the token and the user", async () => {
    localStorage.setItem("token", "pre-existing-token");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u1", email: "student@test.com", is_admin: false }), { status: 200 })
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("student@test.com"));

    await userEvent.click(screen.getByText("logout"));

    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("refreshUser re-fetches /api/auth/me and picks up a role change without a fresh login", async () => {
    // The scenario this guards against: a browser tab logs in as a normal
    // user, then that account is promoted to admin on the backend (e.g. via
    // the INITIAL_ADMIN_EMAIL bootstrap). The tab's cached `user` object
    // must not stay stuck at is_admin: false forever -- refreshUser is the
    // mechanism that resyncs it against the live server.
    localStorage.setItem("token", "pre-existing-token");
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "u1", email: "promoted@test.com", is_admin: false }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "u1", email: "promoted@test.com", is_admin: true }), { status: 200 })
      );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("is-admin")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("refresh"));

    await waitFor(() => expect(screen.getByTestId("is-admin")).toHaveTextContent("true"));
  });

  it("refreshUser clears the session if the token is no longer valid", async () => {
    localStorage.setItem("token", "pre-existing-token");
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "u1", email: "student@test.com", is_admin: false }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("student@test.com"));

    await userEvent.click(screen.getByText("refresh"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(localStorage.getItem("token")).toBeNull();
  });
});

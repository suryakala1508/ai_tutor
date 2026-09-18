import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setToken } from "./api";

describe("api client", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a network failure as ApiError(0, ...) instead of a raw exception", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.get("/api/ping")).rejects.toMatchObject({
      status: 0,
      message: "Could not reach the server. Check your connection and try again.",
    });
  });

  it("parses a successful JSON response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await api.get<{ ok: boolean }>("/api/ping");
    expect(result).toEqual({ ok: true });
  });

  it("raises ApiError with the server's detail message on a non-2xx response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Project not found" }), { status: 404 })
    );

    await expect(api.get("/api/projects/missing")).rejects.toMatchObject({
      status: 404,
      message: "Project not found",
    });
  });

  it("attaches the Authorization header when a token is set, and omits it otherwise", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response("{}", { status: 200 }));

    await api.get("/api/anonymous");
    let headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();

    setToken("test-token-123");
    await api.get("/api/authed");
    headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].headers;
    expect(headers.Authorization).toBe("Bearer test-token-123");
  });

  it("does not set Content-Type when the body is FormData (lets the browser set the multipart boundary)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("{}", { status: 200 }));

    const form = new FormData();
    form.append("file", new Blob(["data"]), "notes.pdf");
    await api.postForm("/api/projects/p1/materials", form);

    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("ApiError carries a numeric status distinguishable from a network failure", () => {
    const err = new ApiError(404, "not found");
    expect(err.status).toBe(404);
    expect(err).toBeInstanceOf(Error);
  });
});

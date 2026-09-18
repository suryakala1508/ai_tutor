const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8811";

function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

// Lets AuthProvider react to a session that died mid-app (expired/invalid
// token on some later request, not just the initial page load) without api.ts
// needing router access — it just clears the session; ProtectedRoute (which
// watches useAuth().user) handles the actual redirect to /login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let detail = "Something went wrong. Please try again.";
    try {
      const body = await res.json();
      detail = body.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : detail;
    } catch {
      // ignore — non-JSON error body
    }
    // A 401 from login/signup itself just means "wrong credentials" — a
    // normal part of that flow, not a dead session, so it shouldn't clear
    // anything. Any other 401 means the token we sent was rejected.
    if (res.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/signup")) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { ApiError, API_BASE };

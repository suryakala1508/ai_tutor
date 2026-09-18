import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { ErrorBanner } from "../components/Feedback";

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await signup(name, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div className="brand" style={{ justifyContent: "center", marginBottom: 28, cursor: "default" }}>
          <span className="mark" aria-hidden="true" />
          <span className="disp" style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-.02em" }}>AI Tutor</span>
        </div>
        <div className="card">
          <h1 className="h-disp" style={{ fontSize: 22, marginBottom: 18 }}>
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && <ErrorBanner message={error} />}
            {mode === "signup" && (
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                Name
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%", marginTop: 5 }}
                />
              </label>
            )}
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", marginTop: 5 }}
              />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", marginTop: 5 }}
              />
            </label>
            {mode === "signup" && (
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                Confirm password
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: "100%", marginTop: 5 }}
                />
              </label>
            )}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
            </button>
          </form>
        </div>
        <p style={{ marginTop: 18, textAlign: "center", fontSize: 13.5, color: "var(--muted)" }}>
          {mode === "login" ? (
            <>No account? <a href="/signup">Sign up</a></>
          ) : (
            <>Already have an account? <a href="/login">Log in</a></>
          )}
        </p>
      </div>
    </div>
  );
}

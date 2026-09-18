import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { ErrorBanner } from "../components/Feedback";

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M1.667 10s3.056-6.25 8.333-6.25S18.333 10 18.333 10s-3.056 6.25-8.333 6.25S1.667 10 1.667 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2.5 2.5l15 15M8.36 8.36a2.5 2.5 0 0 0 3.28 3.28M6.1 6.14C3.6 7.32 1.667 10 1.667 10s3.056 6.25 8.333 6.25c1.42 0 2.66-.32 3.72-.82M14.07 5.86A9.6 9.6 0 0 0 10 3.75c-.55 0-1.08.05-1.6.14M18.333 10s-1.02 2.08-2.87 3.73"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={visible ? "text" : "password"}
        required
        minLength={8}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", marginTop: 5, paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(calc(-50% + 2.5px))",
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: "var(--muted)",
          display: "flex",
        }}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function passwordStrength(password: string): { label: string; className: string } | null {
  if (!password) return null;
  if (password.length < 8) return { label: "Too short (min 8 characters)", className: "bad" };
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const score = [hasLetter, hasNumber, hasSpecial].filter(Boolean).length;
  if (score >= 3) return { label: "Strong password", className: "good" };
  if (score === 2) return { label: "Good — add a symbol for extra strength", className: "mid" };
  return { label: "Weak — add numbers or symbols", className: "bad" };
}

const STRENGTH_COLOR: Record<string, string> = {
  good: "#0a8a5a",
  mid: "#a5620a",
  bad: "#c81e46",
};

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = mode === "signup" ? passwordStrength(password) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
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
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>
            {mode === "signup" && strength && (
              <div style={{ marginTop: -8, fontSize: 12.5, color: STRENGTH_COLOR[strength.className], fontWeight: 600 }}>
                {strength.label}
              </div>
            )}
            {mode === "signup" && (
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                Confirm password
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
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

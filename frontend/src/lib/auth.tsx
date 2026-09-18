import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken, setUnauthorizedHandler } from "./api";

interface User {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // A 401 on any later request (token expired/invalidated mid-session, not
  // just on initial load) clears the session here so ProtectedRoute redirects
  // to /login instead of leaving the user stuck on a broken authenticated page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{
      access_token: string;
      user_id: string;
      name: string;
      email: string;
      is_admin: boolean;
    }>("/api/auth/login", { email, password });
    setToken(res.access_token);
    setUser({ id: res.user_id, name: res.name, email: res.email, is_admin: res.is_admin });
  }

  async function signup(name: string, email: string, password: string) {
    const res = await api.post<{
      access_token: string;
      user_id: string;
      name: string;
      email: string;
      is_admin: boolean;
    }>("/api/auth/signup", { name, email, password });
    setToken(res.access_token);
    setUser({ id: res.user_id, name: res.name, email: res.email, is_admin: res.is_admin });
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  /** Re-fetches the current user from the server rather than trusting the
   * cached session — e.g. a role change (like being promoted to admin)
   * takes effect on the backend immediately, but a long-lived browser tab's
   * cached `user` object only reflects whatever was true at login time
   * until something forces a resync. Returns null (and clears the session)
   * if the token is no longer valid. */
  async function refreshUser(): Promise<User | null> {
    try {
      const me = await api.get<User>("/api/auth/me");
      setUser(me);
      return me;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

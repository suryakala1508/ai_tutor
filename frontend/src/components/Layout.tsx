import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ConfirmModal } from "./ConfirmModal";
import { UserMenu } from "./UserMenu";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const location = useLocation();

  return (
    <div>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand">
            <span className="mark" aria-hidden="true" />
            AI Tutor
          </Link>
          {user && (
            <nav style={{ display: "flex", gap: 6, flex: 1 }}>
              <Link to="/" className={`nav-link${location.pathname === "/" ? " active" : ""}`}>Home</Link>
              <Link to="/analytics" className={`nav-link${location.pathname === "/analytics" ? " active" : ""}`}>Analytics</Link>
              {user.is_admin && (
                <Link to="/admin" className={`nav-link${location.pathname === "/admin" ? " active" : ""}`}>Admin</Link>
              )}
            </nav>
          )}
          {user && (
            <UserMenu name={user.name} email={user.email} onLogout={() => setConfirmingLogout(true)} />
          )}
        </div>
      </header>
      {confirmingLogout && (
        <ConfirmModal
          title="Log out?"
          message="You'll need to log back in to access your account."
          confirmLabel="Log out"
          onConfirm={() => {
            logout();
            setConfirmingLogout(false);
            navigate("/login");
          }}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
      <Outlet />
    </div>
  );
}

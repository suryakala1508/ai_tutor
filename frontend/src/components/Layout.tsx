import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ConfirmModal } from "./ConfirmModal";
import { UserMenu } from "./UserMenu";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const location = useLocation();

  return (
    <div>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand" onClick={() => setMobileNavOpen(false)}>
            <span className="mark" aria-hidden="true" />
            AI Tutor
          </Link>
          {user && (
            <nav className="main-nav" style={{ display: "flex", gap: 6, flex: 1 }}>
              <Link to="/" className={`nav-link${location.pathname === "/" ? " active" : ""}`}>Home</Link>
              <Link to="/analytics" className={`nav-link${location.pathname === "/analytics" ? " active" : ""}`}>Analytics</Link>
              {user.is_admin && (
                <Link to="/admin" className={`nav-link${location.pathname === "/admin" ? " active" : ""}`}>Admin</Link>
              )}
            </nav>
          )}
          {user && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="hamburger"
                aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen((o) => !o)}
              >
                <span /><span /><span />
              </button>
              <UserMenu name={user.name} email={user.email} onLogout={() => setConfirmingLogout(true)} />
            </div>
          )}
        </div>
        {user && (
          <div className={`topbar-mobile-menu${mobileNavOpen ? " open" : ""}`}>
            <Link to="/" className={`nav-link${location.pathname === "/" ? " active" : ""}`} onClick={() => setMobileNavOpen(false)}>Home</Link>
            <Link to="/analytics" className={`nav-link${location.pathname === "/analytics" ? " active" : ""}`} onClick={() => setMobileNavOpen(false)}>Analytics</Link>
            {user.is_admin && (
              <Link to="/admin" className={`nav-link${location.pathname === "/admin" ? " active" : ""}`} onClick={() => setMobileNavOpen(false)}>Admin</Link>
            )}
          </div>
        )}
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

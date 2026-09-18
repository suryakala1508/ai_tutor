import { useEffect, useRef, useState } from "react";

function initialsFor(name: string, email: string): string {
  const trimmedName = name.trim();
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
    return letters.toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu({
  name,
  email,
  onLogout,
}: {
  name: string;
  email: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const initials = initialsFor(name, email);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={name.trim() || email}
        aria-label="Account menu"
        className="avatar"
        style={{ border: "none" }}
      >
        {initials}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: 48,
            right: 0,
            minWidth: 200,
            padding: 10,
            zIndex: 50,
          }}
        >
          <div style={{ padding: "4px 4px 12px" }}>
            {name.trim() && <div style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>}
            <div style={{ fontSize: 12.5, color: "var(--muted)", wordBreak: "break-all", marginTop: 2 }}>{email}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: "100%" }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

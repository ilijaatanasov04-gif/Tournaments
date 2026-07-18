import { useState, useEffect } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import Tournaments from "./pages/Tournaments";
import TournamentDetail from "./pages/TournamentDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import api from "./api";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (token) {
      api.get("/auth/me").then(r => setUser(r.data)).catch(() => {});
    }
  }, [token]);

  function logout() {
    localStorage.removeItem("token");
    setUser(null);
    navigate("/login");
  }

  const onAuthPage = location.pathname === "/login" || location.pathname === "/register";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={nav.bar}>
        <div className="nav-inner" style={nav.inner}>
          <Link to="/" style={nav.brand}>
            <span className="brand-kicker" style={nav.brandKicker}>TM</span>
            <span className="brand-word" style={nav.brandWord}>Tournament Manager</span>
          </Link>

          <div style={nav.actions}>
            {token && user ? (
              <>
                <div style={nav.userBlock}>
                  <span style={nav.userRole}>{user.role}</span>
                  <span className="nav-user-email" style={nav.userEmail}>{user.email}</span>
                </div>
                <span style={nav.divider} />
                <button style={nav.signOutBtn} onClick={logout}>Sign out</button>
              </>
            ) : !onAuthPage ? (
              <>
                <Link to="/login" style={nav.linkBtn}>Sign in</Link>
                <Link to="/register" style={nav.primaryBtn}>Create account</Link>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Tournaments user={user} />} />
          <Route path="/tournaments/:id" element={<TournamentDetail user={user} />} />
          <Route path="/login" element={<Login setUser={setUser} />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </main>

      <footer style={nav.footer}>
        <span>Tournament Manager</span>
      </footer>
    </div>
  );
}

const nav = {
  bar: {
    background: "rgba(255, 255, 255, .85)",
    backdropFilter: "blur(14px) saturate(1.4)",
    WebkitBackdropFilter: "blur(14px) saturate(1.4)",
    borderBottom: "1px solid var(--border)",
    position: "sticky", top: 0, zIndex: 100,
  },
  inner: {
    maxWidth: 1240, margin: "0 auto", padding: "0 32px",
    height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,
  },
  brand: {
    display: "inline-flex", alignItems: "center", gap: 12,
    color: "var(--ink)", textDecoration: "none", whiteSpace: "nowrap",
  },
  brandKicker: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 30, height: 30,
    fontSize: 12, fontWeight: 900, color: "var(--accent-ink)",
    background: "var(--accent)",
    borderRadius: 8,
    letterSpacing: ".5px",
    boxShadow: "0 2px 12px rgba(var(--accent-rgb), .35)",
  },
  brandWord: {
    fontFamily: "var(--font-display)",
    fontSize: 19, fontWeight: 700, color: "var(--ink)",
    textTransform: "uppercase", letterSpacing: "2.6px",
  },
  actions: { display: "flex", gap: 14, alignItems: "center" },
  userBlock: {
    display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2,
  },
  userRole: {
    fontSize: 10, fontWeight: 800, color: "var(--accent)",
    textTransform: "uppercase", letterSpacing: "1.4px",
  },
  userEmail: {
    fontSize: 13, color: "var(--text)",
    maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  divider: {
    width: 1, height: 28, background: "var(--border2)",
  },
  signOutBtn: {
    background: "transparent", border: "1px solid var(--border2)",
    borderRadius: 8,
    color: "var(--text)", fontSize: 13, fontWeight: 600,
    padding: "7px 16px", cursor: "pointer",
    transition: "border-color .15s, color .15s",
  },
  linkBtn: {
    fontSize: 13, fontWeight: 600, color: "var(--text)",
    padding: "7px 12px", textDecoration: "none",
  },
  primaryBtn: {
    fontSize: 13, fontWeight: 800, color: "var(--accent-ink)",
    background: "var(--accent)", padding: "8px 18px",
    borderRadius: 8,
    textDecoration: "none",
  },
  footer: {
    textAlign: "center", padding: "24px 24px",
    borderTop: "1px solid var(--border)", color: "var(--muted)",
    fontSize: 11, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "2.4px",
    marginTop: 40,
  },
};

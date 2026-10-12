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
    /* Saturated blur so the tinted canvas wash reads through the bar instead of
       washing out to flat grey. */
    background: "rgba(255, 255, 255, .72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: "inset 0 -1px 0 var(--border)",
    position: "sticky", top: 0, zIndex: 100,
  },
  inner: {
    maxWidth: 1180, margin: "0 auto", padding: "0 32px",
    height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,
  },
  brand: {
    display: "inline-flex", alignItems: "center", gap: 11,
    color: "var(--ink)", textDecoration: "none", whiteSpace: "nowrap",
  },
  brandKicker: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28,
    fontSize: 11.5, fontWeight: 680, color: "var(--accent-ink)",
    letterSpacing: "-.02em",
    background: "linear-gradient(150deg, var(--accent-lt), var(--accent-dk))",
    borderRadius: 8,
    boxShadow: "0 1px 2px rgba(16,24,40,.14), 0 4px 10px -4px rgba(var(--accent-rgb),.55), inset 0 1px 0 rgba(255,255,255,.28)",
  },
  brandWord: {
    fontSize: 15, fontWeight: 620, color: "var(--ink)",
    letterSpacing: "-.02em",
  },
  actions: { display: "flex", gap: 14, alignItems: "center" },
  userBlock: {
    display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25,
  },
  userRole: {
    fontSize: 11, fontWeight: 550, color: "var(--faint)",
    textTransform: "capitalize",
  },
  userEmail: {
    fontSize: 13, color: "var(--ink)", fontWeight: 550,
    letterSpacing: "-.01em",
    maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  divider: {
    width: 1, height: 22, background: "var(--border2)",
  },
  signOutBtn: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 9,
    color: "var(--text)", fontSize: 13, fontWeight: 550,
    padding: "7px 14px", cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "var(--shadow-xs)",
    transition: "box-shadow .18s var(--ease), color .18s var(--ease)",
  },
  linkBtn: {
    fontSize: 13.5, fontWeight: 550, color: "var(--text)",
    padding: "7px 12px", textDecoration: "none",
  },
  primaryBtn: {
    fontSize: 13.5, fontWeight: 560, color: "var(--accent-ink)",
    background: "linear-gradient(180deg, var(--accent-lt), var(--accent))",
    padding: "8px 16px",
    borderRadius: 9,
    textDecoration: "none",
    boxShadow: "var(--shadow-accent), inset 0 1px 0 rgba(255,255,255,.22)",
  },
  footer: {
    textAlign: "center", padding: "26px 24px",
    borderTop: "1px solid var(--border)", color: "var(--faint)",
    fontSize: 13, fontWeight: 450, letterSpacing: "-.005em",
    marginTop: 56,
  },
};

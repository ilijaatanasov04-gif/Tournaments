import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api";

export default function Register() {
  const [form, setForm] = useState({ email: "", password: "", confirm: "", role: "user" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const passwordMismatch = form.confirm && form.password !== form.confirm;

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/register", { email: form.email, password: form.password, role: form.role });
      navigate("/login");
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h2 className="auth-title">Create account</h2>
        <p className="auth-subtitle">Join Tournament Manager</p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label className="field-label">Email</label>
            <input className="input" type="email" placeholder="you@example.com"
              value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>

          <div className="field">
            <label className="field-label">Password</label>
            <input className="input" type="password" placeholder="••••••••"
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
          </div>

          <div className="field">
            <label className="field-label">Confirm Password</label>
            <input
              className={`input ${passwordMismatch ? "is-error" : ""}`}
              type="password"
              placeholder="••••••••"
              value={form.confirm}
              onChange={e => setForm({ ...form, confirm: e.target.value })}
              required
            />
            {passwordMismatch && <span className="field-error">Passwords do not match</span>}
          </div>

          <div className="field">
            <label className="field-label">Role</label>
            <div className="role-row">
              {["user", "organizer"].map(r => (
                <button type="button" key={r}
                  onClick={() => setForm({ ...form, role: r })}
                  className={`role-option ${form.role === r ? "selected" : ""}`}>
                  <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{r}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {r === "user" ? "View tournaments" : "Manage tournaments"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={loading || !!passwordMismatch}
            style={{ marginTop: 8 }}
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

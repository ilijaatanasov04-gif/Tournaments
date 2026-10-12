import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useToast, errMsg } from "../components/toast";


// Location suggestions shown in the create form — replace with the cities of
// your league or region. The filter dropdown is built from real tournament
// data, so any custom location is supported and shown automatically.
const LOCATION_SUGGESTIONS = ["London", "Madrid", "Milan", "Munich", "Paris", "Lisbon", "Amsterdam", "Vienna", "Prague", "Warsaw", "Athens", "Zagreb"];
const STATUS_FILTERS = [
  { id: "ongoing",  label: "Ongoing",  dot: "var(--accent)" },
  { id: "upcoming", label: "Upcoming", dot: "#3b82f6" },
  { id: "finished", label: "Completed", dot: "var(--gold)" },
];

// Stadium / pitch imagery used as the card hero. Picked deterministically from
// tournament id so each tournament has a stable image.
const TOURNAMENT_IMAGES = [
  "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1518604666860-9ed391f76460?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1577223625816-7546f13df25d?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=900&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?w=900&auto=format&fit=crop&q=70",
];
const imageFor = (id) => TOURNAMENT_IMAGES[Math.abs(id) % TOURNAMENT_IMAGES.length];

export default function Tournaments({ user }) {
  const [tournaments, setTournaments] = useState([]);
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "", location: "", format: "", prize_pool: "",
    prize_first: "", prize_second: "", prize_third: "", prize_fourth: "",
  });
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();
  const isOrganizer = user?.role === "organizer";

  useEffect(() => {
    Promise.all([
      api.get("/tournaments").then(r => setTournaments(r.data)),
      api.get("/formats").then(r => {
        setFormats(r.data);
        if (r.data[0]) setForm(f => ({ ...f, format: f.format || r.data[0].key }));
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const PHASE_LABEL = {
    group_stage: "Group Stage",
    round_of_16: "Round of 16",
    quarter_final: "Quarter Final",
    semi_final: "Semi Final",
    final: "Final",
  };

  const statusOf = (t) => {
    if (t.champion_name) return "finished";
    if (t.match_done > 0) return "ongoing";
    return "upcoming";
  };

  // The status badge sits on a near-white glass chip over the photo, so these
  // are darkened for contrast. The dot's halo is built by appending "22" — so
  // these must stay hex, no var().
  const tournamentStatus = (t) => {
    const s = statusOf(t);
    if (s === "finished") return { label: "Finished", color: "#a16207" };
    if (s === "ongoing") return { label: "Ongoing", color: "#15803d" };
    return { label: "Upcoming", color: "#52525b" };
  };

  const q = search.trim().toLowerCase();
  const filtered = tournaments.filter(t => {
    if (q) {
      if (!(t.name.toLowerCase().includes(q) || t.location?.toLowerCase().includes(q))) return false;
    }
    if (locationFilter && t.location !== locationFilter) return false;
    if (statusFilter && statusOf(t) !== statusFilter) return false;
    return true;
  });

  const availableLocations = [...new Set(
    tournaments.map(t => t.location).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  async function deleteTournament(e, t) {
    e.stopPropagation();
    if (!confirm(`Delete tournament "${t.name}"? This removes all teams, matches, and standings.`)) return;
    try {
      await api.delete(`/tournaments/${t.id}`);
      setTournaments(prev => prev.filter(x => x.id !== t.id));
      toast.success(`Deleted "${t.name}"`);
    } catch (err) {
      toast.error(errMsg(err, "Error deleting tournament"));
    }
  }

  async function createTournament(e) {
    e.preventDefault();
    try {
      const toInt = (v) => v ? parseInt(v, 10) : null;
      const payload = {
        name: form.name,
        format: form.format || undefined,
        location: form.location || null,
        prize_pool: toInt(form.prize_pool),
        prize_first: toInt(form.prize_first),
        prize_second: toInt(form.prize_second),
        prize_third: toInt(form.prize_third),
        prize_fourth: toInt(form.prize_fourth),
      };
      const res = await api.post("/tournaments", payload);
      setTournaments([...tournaments, res.data]);
      setShowForm(false);
      setForm({
        name: "", location: "", format: formats[0]?.key || "", prize_pool: "",
        prize_first: "", prize_second: "", prize_third: "", prize_fourth: "",
      });
      toast.success(`Created "${res.data.name}"`);
    } catch (err) {
      toast.error(errMsg(err, "Error creating tournament"));
    }
  }

  return (
    <div className="page">
      <div style={s.hero}>
        <div style={s.heroText}>
          <span style={s.heroEyebrow}>
            <span style={s.heroEyebrowDot} />
            Organize · Compete · Win
          </span>
          <h1 className="hero-title" style={s.heroTitle}>All Football Tournaments</h1>
          <p style={s.heroSubtitle}>
            Find, follow and manage tournaments in one place.
            Currently showing <strong style={{ color: "var(--ink)", fontWeight: 620 }}>{filtered.length}</strong> of {tournaments.length}.
          </p>
        </div>
        <div style={s.heroVisualWrap}>
          <div style={s.heroGlow} />
          <PitchVisual />
        </div>
      </div>

      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          <div style={s.toolbarGroup}>
            <span style={s.filterLabel}>Status</span>
            <div style={s.chips}>
              <Chip active={statusFilter === null} onClick={() => setStatusFilter(null)}>All</Chip>
              {STATUS_FILTERS.map(sf => (
                <Chip key={sf.id} active={statusFilter === sf.id} dot={sf.dot} onClick={() => setStatusFilter(sf.id)}>
                  {sf.label}
                </Chip>
              ))}
            </div>
          </div>
          <div style={s.toolbarDivider} />
          <div style={s.toolbarGroup}>
            <span style={s.filterLabel}>Location</span>
            <select
              className="select"
              style={{ minWidth: 180, width: "auto", height: 36 }}
              value={locationFilter ?? ""}
              onChange={e => setLocationFilter(e.target.value || null)}
            >
              <option value="">All locations</option>
              {availableLocations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
          <div style={s.toolbarDivider} />
          <div style={s.toolbarGroup}>
            <span style={s.filterLabel}>Search</span>
            <div style={s.searchWrap}>
              <input
                className="input"
                style={{ width: 240, height: 36 }}
                placeholder="Name or location"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button style={s.clearBtn} onClick={() => setSearch("")}>Clear</button>
              )}
            </div>
          </div>
        </div>
        {isOrganizer && (
          <button
            className={`btn ${showForm ? "btn-ghost" : "btn-primary"}`}
            style={{ height: 36, padding: "0 14px" }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "New Tournament"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="form-card">
          <h3 style={{ marginBottom: 16 }}>New Tournament</h3>
          <form onSubmit={createTournament}>
            <div style={s.formGrid}>
              <div className="field">
                <label className="field-label">Tournament Name</label>
                <input className="input" placeholder="e.g. Spring Cup 2026"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="field">
                <label className="field-label">Format</label>
                <select className="select" value={form.format}
                  onChange={e => setForm({ ...form, format: e.target.value })}>
                  {formats.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Location</label>
                <input
                  className="input"
                  list="location-suggestions"
                  placeholder="e.g. Skopje"
                  value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                />
                <datalist id="location-suggestions">
                  {[...new Set([...LOCATION_SUGGESTIONS, ...availableLocations])].map(loc => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label className="field-label">Prize Pool (€, optional)</label>
                <input className="input" type="number" min="0" step="50" placeholder="1000"
                  value={form.prize_pool} onChange={e => setForm({ ...form, prize_pool: e.target.value })} />
              </div>
            </div>

            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 12 }}>
                Prize Distribution (optional)
              </p>
              <div style={s.prizeGrid}>
                {[
                  { key: "prize_first",  label: "1st Place" },
                  { key: "prize_second", label: "2nd Place" },
                  { key: "prize_third",  label: "3rd Place" },
                  { key: "prize_fourth", label: "4th Place" },
                ].map(({ key, label }) => (
                  <div className="field" key={key}>
                    <label className="field-label">{label} (€)</label>
                    <input className="input" type="number" min="0" step="50"
                      placeholder="0"
                      value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" type="submit">
                Create Tournament
              </button>
            </div>
          </form>
          {(() => {
            const selected = formats.find(f => f.key === form.format);
            if (!selected) return null;
            return (
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
                Uses <strong style={{ color: "var(--text)" }}>{selected.group_count} groups</strong> (A–{String.fromCharCode(64 + selected.group_count)}),
                top <strong style={{ color: "var(--text)" }}>{selected.advancing_per_group}</strong> from each advance to the{" "}
                <strong style={{ color: "var(--text)" }}>{selected.phases.find(p => !p.is_group_stage)?.label}</strong>.
              </p>
            );
          })()}
        </div>
      )}

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading tournaments…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {tournaments.length === 0
            ? `No tournaments yet. ${isOrganizer ? "Create the first one!" : ""}`
            : `No tournaments matching "${search}".`}
        </div>
      ) : (
        <div className="grid-3">
          {filtered.map(t => {
            const status = tournamentStatus(t);
            const isMine = t.organizer_id === user?.id;
            const pct = t.match_total > 0 ? Math.round((t.match_done / t.match_total) * 100) : 0;
            const phaseLabel = t.current_phase ? PHASE_LABEL[t.current_phase] : null;
            return (
              <div key={t.id} className="t-card" style={s.tournamentCard}
                   onClick={() => navigate(`/tournaments/${t.id}`)}>
                <div style={s.cardImage}>
                  <div className="t-card-photo"
                       style={{ ...s.cardPhoto, backgroundImage: `url("${imageFor(t.id)}")` }} />
                  <div style={s.cardImageScrim} />
                  <div style={s.cardImageTop}>
                    <span style={{ ...s.statusBadge, color: status.color }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: status.color, flexShrink: 0, boxShadow: `0 0 0 3px ${status.color}22` }} />
                      {status.label}
                    </span>
                    {isOrganizer && isMine && (
                      <button style={s.deleteBtnFloat} onClick={e => deleteTournament(e, t)} title="Delete tournament">✕</button>
                    )}
                  </div>
                  {phaseLabel && (
                    <span style={s.phaseStamp}>{phaseLabel}</span>
                  )}
                </div>

                <div style={s.cardBody}>
                  <h3 style={s.cardTitle}>{t.name}</h3>

                  <div style={s.cardMetaRow}>
                    {t.location && <span>{t.location}</span>}
                    {t.location && <span style={s.metaDot}>·</span>}
                    <span>{t.team_count} teams</span>
                  </div>

                  <div style={s.prizeBlock}>
                    <span style={s.prizeLabel}>Prize Pool</span>
                    <span style={t.prize_pool ? s.prizeValue : s.prizeValueEmpty}>
                      {t.prize_pool ? `€${t.prize_pool.toLocaleString()}` : "Not set"}
                    </span>
                  </div>

                  {t.champion_name ? (
                    <div style={s.championBlock}>
                      <span style={s.prizeLabel}>Winner</span>
                      <span style={s.championName}>{t.champion_name}</span>
                    </div>
                  ) : (
                    <div style={s.progressWrap}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={s.prizeLabel}>Match progress</span>
                        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {t.match_done}/{t.match_total || 0}
                        </span>
                      </div>
                      <div style={s.progressBar}>
                        <div style={{ ...s.progressFill, width: `${pct}%` }} />
                      </div>
                    </div>
                  )}

                  <div style={s.cardFooter}>
                    <span className="t-card-cta" style={s.cardCta}>
                      View details
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h13M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={s.paginationRow}>
          <button style={s.pageNavBtn} disabled>Prev</button>
          <div style={s.pageDots}>
            <span style={{ ...s.pageDot, ...s.pageDotActive }}>1</span>
            <span style={s.pageDot}>2</span>
            <span style={s.pageDot}>3</span>
          </div>
          <button style={s.pageNavBtn} disabled>Next</button>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children, dot }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 36,
        padding: "0 13px",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--border2)"}`,
        background: active ? "rgba(var(--accent-rgb),.05)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--text)",
        transition: "border-color .15s, color .15s, background .15s",
      }}
    >
      {dot && (
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: dot, flexShrink: 0,
        }} />
      )}
      {children}
    </button>
  );
}

function PitchVisual() {
  return (
    <svg viewBox="0 0 220 130" width="280" height="170" style={{ flexShrink: 0, opacity: 0.92, position: "relative", zIndex: 1 }}>
      <defs>
        <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(var(--accent-rgb),0.10)" />
          <stop offset="100%" stopColor="rgba(var(--accent-rgb),0.02)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="214" height="124" rx="6" fill="url(#pitchGrad)" stroke="rgba(var(--accent-rgb),.45)" strokeWidth="1.4" />
      <line x1="110" y1="3" x2="110" y2="127" stroke="rgba(var(--accent-rgb),.35)" strokeWidth="1.2" />
      <circle cx="110" cy="65" r="16" fill="none" stroke="rgba(var(--accent-rgb),.4)" strokeWidth="1.2" />
      <circle cx="110" cy="65" r="1.6" fill="rgba(var(--accent-rgb),.7)" />
      {/* left penalty */}
      <rect x="3" y="35" width="38" height="60" fill="none" stroke="rgba(var(--accent-rgb),.32)" strokeWidth="1.1" />
      <rect x="3" y="48" width="14" height="34" fill="none" stroke="rgba(var(--accent-rgb),.32)" strokeWidth="1.1" />
      {/* right penalty */}
      <rect x="179" y="35" width="38" height="60" fill="none" stroke="rgba(var(--accent-rgb),.32)" strokeWidth="1.1" />
      <rect x="203" y="48" width="14" height="34" fill="none" stroke="rgba(var(--accent-rgb),.32)" strokeWidth="1.1" />
      {/* ball */}
      <circle cx="48" cy="65" r="3.2" fill="#fff" stroke="rgba(16,24,40,.35)" strokeWidth=".8" />
    </svg>
  );
}

const s = {
  hero: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 32, marginBottom: 30, flexWrap: "wrap",
    padding: "8px 0 28px",
  },
  heroText: { flex: "1 1 320px", minWidth: 240 },
  heroEyebrow: {
    display: "inline-flex", alignItems: "center", gap: 8,
    fontSize: 12.5, fontWeight: 550, color: "var(--muted)",
    padding: "5px 12px 5px 10px",
    background: "var(--surface)",
    borderRadius: 99,
    boxShadow: "var(--shadow-xs)",
  },
  heroEyebrowDot: {
    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
    background: "var(--accent)",
    boxShadow: "0 0 0 3px rgba(var(--accent-rgb),.16)",
  },
  heroTitle: {
    fontSize: 38, fontWeight: 680, color: "var(--ink)",
    margin: "14px 0 10px", lineHeight: 1.08, letterSpacing: "-.032em",
  },
  heroSubtitle: { color: "var(--muted)", fontSize: 14.5, lineHeight: 1.65, maxWidth: 520 },
  heroVisualWrap: { position: "relative", flexShrink: 0, display: "grid", placeItems: "center" },
  heroGlow: {
    position: "absolute", width: 300, height: 190,
    background: "radial-gradient(closest-side, rgba(var(--accent-rgb),.16), transparent 72%)",
    filter: "blur(10px)", pointerEvents: "none",
  },
  toolbar: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    gap: 24, flexWrap: "wrap", marginBottom: 28,
    paddingBottom: 22,
    borderBottom: "1px solid var(--border)",
  },
  toolbarLeft: { display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" },
  toolbarGroup: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  toolbarDivider: { display: "none" },
  filterLabel: {
    fontSize: 12, fontWeight: 500, color: "var(--muted)",
  },
  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  formGrid: { display: "grid", gridTemplateColumns: "1.3fr 1.3fr 1fr 1fr", gap: 16, alignItems: "start" },
  prizeGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 },
  searchWrap: { position: "relative", display: "flex", alignItems: "center" },
  searchIcon: { position: "absolute", left: 10, fontSize: 13, pointerEvents: "none" },
  clearBtn: {
    position: "absolute", right: 8, background: "none", border: "none",
    color: "var(--muted)", cursor: "pointer", fontSize: 12, lineHeight: 1,
  },
  tournamentCard: {
    position: "relative", display: "flex", flexDirection: "column",
    background: "var(--surface)",
    border: "none",
    borderRadius: 16, overflow: "hidden",
    cursor: "pointer",
  },
  cardImage: {
    position: "relative",
    height: 148,
    overflow: "hidden",
  },
  cardPhoto: {
    position: "absolute", inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
  },
  cardImageScrim: {
    position: "absolute", inset: 0,
    /* Three-stop scrim: keeps the top readable for the chip, deepens toward the
       caption, and the inset hairline stops the photo bleeding into the body. */
    background:
      "linear-gradient(180deg, rgba(10,14,24,.34) 0%, rgba(10,14,24,.05) 42%, rgba(10,14,24,.72) 100%)",
    boxShadow: "inset 0 -1px 0 rgba(16,24,40,.10)",
  },
  cardImageTop: {
    position: "absolute", top: 11, left: 11, right: 11,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    zIndex: 2,
  },
  statusBadge: {
    display: "inline-flex", alignItems: "center", gap: 6,
    height: 24, padding: "0 10px",
    background: "rgba(255,255,255,.86)",
    backdropFilter: "blur(10px) saturate(160%)",
    WebkitBackdropFilter: "blur(10px) saturate(160%)",
    borderRadius: 99,
    boxShadow: "0 1px 3px rgba(16,24,40,.18), inset 0 0 0 1px rgba(255,255,255,.6)",
    fontSize: 11.5, fontWeight: 620, letterSpacing: "-.005em",
  },
  phaseStamp: {
    position: "absolute", left: 14, bottom: 12, zIndex: 2,
    fontSize: 12, fontWeight: 560, color: "#fff",
    letterSpacing: "-.005em",
    textShadow: "0 1px 3px rgba(0,0,0,.4)",
  },
  deleteBtnFloat: {
    width: 26, height: 26, borderRadius: 8,
    background: "rgba(10,14,24,.55)",
    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,.2)",
    color: "rgba(255,255,255,.9)", cursor: "pointer",
    fontSize: 11, lineHeight: 1, padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  cardBody: {
    padding: 20, display: "flex", flexDirection: "column", flex: 1,
  },
  cardTitle: {
    fontSize: 17, fontWeight: 620, color: "var(--ink)",
    margin: "0 0 5px", letterSpacing: "-.022em", lineHeight: 1.28,
  },
  cardMetaRow: {
    display: "flex", alignItems: "center", gap: 6,
    fontSize: 13, color: "var(--muted)", marginBottom: 16,
  },
  metaDot: { color: "var(--border2)" },
  prizeBlock: {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    paddingBottom: 13, marginBottom: 13,
    borderBottom: "1px solid var(--border)",
  },
  prizeLabel: {
    fontSize: 12, fontWeight: 550, color: "var(--faint)",
  },
  prizeValue: {
    fontSize: 18, fontWeight: 650, color: "var(--ink)",
    letterSpacing: "-.025em",
    fontVariantNumeric: "tabular-nums",
  },
  prizeValueEmpty: {
    fontSize: 13, color: "var(--muted)",
  },
  championBlock: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "9px 12px", marginBottom: 4,
    borderRadius: 9,
    background: "linear-gradient(90deg, rgba(234,179,8,.13), rgba(234,179,8,.03))",
    boxShadow: "inset 2px 0 0 var(--gold-bright)",
  },
  championName: {
    fontSize: 14, fontWeight: 650, color: "var(--ink)", letterSpacing: "-.015em",
  },
  deleteBtn: {
    width: 26, height: 26, borderRadius: 6,
    background: "transparent", border: "1px solid var(--border)",
    color: "var(--muted)", cursor: "pointer",
    fontSize: 12, lineHeight: 1, padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    transition: "color .15s, border-color .15s",
  },
  progressWrap: { marginTop: 4 },
  progressBar: {
    height: 6, background: "var(--surface3)", overflow: "hidden",
    borderRadius: 99,
    boxShadow: "inset 0 1px 2px rgba(16,24,40,.06)",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--accent-lt), var(--accent-dk))",
    borderRadius: 99,
    boxShadow: "0 1px 4px -1px rgba(var(--accent-rgb),.5)",
    transition: "width .5s var(--ease)",
  },
  championBox: {
    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
    background: "linear-gradient(135deg, rgba(245,158,11,.12), rgba(245,158,11,.04))",
    border: "1px solid rgba(245,158,11,.3)",
    borderRadius: 10, marginTop: 4,
  },
  cardFooter: {
    marginTop: "auto", paddingTop: 16,
    borderTop: "1px solid var(--border)",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  cardCta: {
    marginLeft: "auto",
    display: "inline-flex", alignItems: "center", gap: 5,
    color: "var(--accent)", fontSize: 13, fontWeight: 620,
    letterSpacing: "-.01em",
  },
  paginationRow: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 14, marginTop: 32,
  },
  pageNavBtn: {
    height: 32, padding: "0 12px",
    background: "transparent", border: "1px solid var(--border2)",
    borderRadius: 8,
    color: "var(--muted)", fontSize: 13, fontWeight: 500,
    fontFamily: "inherit",
    cursor: "not-allowed", opacity: .5,
  },
  pageDots: { display: "flex", gap: 4 },
  pageDot: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 32, height: 32, borderRadius: 8,
    border: "1px solid transparent", color: "var(--muted)",
    fontSize: 13, fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    cursor: "default",
  },
  pageDotActive: {
    borderColor: "transparent", color: "var(--ink)", fontWeight: 620,
    background: "var(--surface)",
    boxShadow: "var(--shadow-xs)",
  },
};

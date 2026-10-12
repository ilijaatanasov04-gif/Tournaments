import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import { useToast, errMsg } from "../components/toast";

// Hex only — these get "22"/"44" alpha suffixes appended, so no var() here.
const GROUP_COLORS = ["#2563eb","#0e8043","#d97706","#dc2626","#7c3aed","#0891b2","#ea580c","#db2777"];

const PHASE_LABEL_FALLBACK = {
  group_stage: "Group Stage",
  playoff: "Playoff",
  round_of_16: "Round of 16",
  quarter_final: "Quarter Final",
  semi_final: "Semi Final",
  final: "Final",
};

const PHASE_COLORS = {
  group_stage: "#64748b",
  playoff: "#9333ea",
  round_of_16: "#0891b2",
  quarter_final: "#2563eb",
  semi_final: "#d97706",
  final: "#0e8043",
};


export default function TournamentDetail({ user: userProp }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [formatSpec, setFormatSpec] = useState(null);
  const [teams, setTeams] = useState([]);
  const [standings, setStandings] = useState([]);
  const [matches, setMatches] = useState([]);
  const [teamForm, setTeamForm] = useState({ name: "", group_name: "A", logo_url: "" });
  const [resultForm, setResultForm] = useState({ matchId: null, score_home: 0, score_away: 0, pen_home: "", pen_away: "" });
  const [dateEdit, setDateEdit] = useState({ matchId: null, value: "", time: "" });
  const [activeTab, setActiveTab] = useState("groups");
  const [localUser, setLocalUser] = useState(userProp);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState(null);
  const [collabEmail, setCollabEmail] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [resultsFilter, setResultsFilter] = useState({ phase: null, date: null });
  const [rosterOpen, setRosterOpen] = useState(null);
  const [rosters, setRosters] = useState({});
  const [playerName, setPlayerName] = useState("");
  const toast = useToast();

  const currentUser = userProp ?? localUser;
  const isCreator = !!permissions?.is_creator;
  const canEdit = !!permissions?.can_edit;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the spinner when navigating between tournaments
    setLoading(true);
    Promise.all([
      api.get(`/tournaments/${id}`).then(r => {
        setTournament(r.data);
        return api.get(`/formats/${r.data.format}`).then(fr => setFormatSpec(fr.data)).catch(() => setFormatSpec(null));
      }),
      api.get(`/tournaments/${id}/teams`).then(r => setTeams(r.data)),
      api.get(`/tournaments/${id}/standings`).then(r => setStandings(r.data)),
      api.get(`/matches?tournament_id=${id}`).then(r => setMatches(r.data)),
      localStorage.getItem("token")
        ? api.get(`/tournaments/${id}/permissions`).then(r => setPermissions(r.data)).catch(() => setPermissions(null))
        : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (localStorage.getItem("token") && !userProp) {
      api.get("/auth/me").then(r => setLocalUser(r.data)).catch(() => {});
    }
  }, [userProp]);

  async function toggleRoster(teamId) {
    if (rosterOpen === teamId) { setRosterOpen(null); return; }
    setRosterOpen(teamId);
    setPlayerName("");
    if (!rosters[teamId]) {
      try {
        const r = await api.get(`/tournaments/${id}/teams/${teamId}/players`);
        setRosters(prev => ({ ...prev, [teamId]: r.data }));
      } catch {
        setRosters(prev => ({ ...prev, [teamId]: [] }));
      }
    }
  }

  async function addPlayer(teamId) {
    const name = playerName.trim();
    if (!name) return;
    try {
      const r = await api.post(`/tournaments/${id}/teams/${teamId}/players`, { name });
      setRosters(prev => ({ ...prev, [teamId]: [...(prev[teamId] || []), r.data] }));
      setPlayerName("");
    } catch (err) {
      toast.error(errMsg(err, "Error adding player"));
    }
  }

  async function removePlayer(teamId, playerId) {
    try {
      await api.delete(`/tournaments/${id}/teams/${teamId}/players/${playerId}`);
      setRosters(prev => ({ ...prev, [teamId]: (prev[teamId] || []).filter(p => p.id !== playerId) }));
    } catch (err) {
      toast.error(errMsg(err, "Error removing player"));
    }
  }

  async function refreshMatches() {
    const r = await api.get(`/matches?tournament_id=${id}`);
    setMatches(r.data);
  }

  async function addTeam(e) {
    e.preventDefault();
    try {
      const res = await api.post(`/tournaments/${id}/teams`, {
        name: teamForm.name,
        group_name: teamForm.group_name,
        logo_url: teamForm.logo_url?.trim() || null,
      });
      setTeams(prev => [...prev, res.data]);
      setTeamForm(f => ({ ...f, name: "", logo_url: "" }));
      api.get(`/tournaments/${id}/standings`).then(r => setStandings(r.data));
      refreshMatches();
    } catch (err) {
      toast.error(errMsg(err, "Error adding team"));
    }
  }

  async function updateTeamGroup(teamId, group_name) {
    const res = await api.patch(`/tournaments/${id}/teams/${teamId}`, { group_name });
    setTeams(prev => prev.map(t => t.id === teamId ? res.data : t));
    refreshMatches();
  }

  async function submitResult(matchId) {
    try {
      const match = matches.find(m => m.id === matchId);
      const home = parseInt(resultForm.score_home);
      const away = parseInt(resultForm.score_away);
      const isKO = match && match.phase !== "group_stage";
      const body = { score_home: home, score_away: away };

      if (isKO && home === away) {
        const ph = parseInt(resultForm.pen_home);
        const pa = parseInt(resultForm.pen_away);
        if (Number.isNaN(ph) || Number.isNaN(pa)) {
          toast.error("Knockout draw — enter penalty shootout scores.");
          return;
        }
        if (ph === pa) {
          toast.error("Penalty shootout cannot end in a tie.");
          return;
        }
        body.pen_home = ph;
        body.pen_away = pa;
      }

      await api.put(`/matches/${matchId}/result`, body);
      setResultForm({ matchId: null, score_home: 0, score_away: 0, pen_home: "", pen_away: "" });
      refreshMatches();
      api.get(`/tournaments/${id}/standings`).then(r => setStandings(r.data));
    } catch (err) {
      toast.error(errMsg(err, "Error saving result"));
    }
  }

  async function handleLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image is too big — please pick something under 5MB");
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => {
            const max = 128;
            const scale = Math.min(max / img.width, max / img.height, 1);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/png", 0.9));
          };
          img.onerror = reject;
          img.src = fr.result;
        };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      setTeamForm(f => ({ ...f, logo_url: dataUrl }));
    } catch {
      toast.error("Couldn't read that image");
    }
  }

  async function saveMatchDate(matchId, value, time) {
    try {
      const res = await api.patch(`/matches/${matchId}`, {
        match_date: value || null,
        match_time: time || null,
      });
      setMatches(prev => prev.map(m => m.id === matchId ? res.data : m));
      setDateEdit({ matchId: null, value: "", time: "" });
    } catch (err) {
      toast.error(errMsg(err, "Error saving date"));
    }
  }

  async function addCollaborator(e) {
    e.preventDefault();
    const email = collabEmail.trim();
    if (!email) return;
    try {
      const res = await api.post(`/tournaments/${id}/collaborators`, { email });
      setPermissions(p => ({ ...p, collaborators: [...(p?.collaborators ?? []), res.data] }));
      setCollabEmail("");
      toast.success(`Added ${res.data.email}`);
    } catch (err) {
      toast.error(errMsg(err, "Error adding collaborator"));
    }
  }

  async function removeCollaborator(userId) {
    try {
      await api.delete(`/tournaments/${id}/collaborators/${userId}`);
      setPermissions(p => ({ ...p, collaborators: (p?.collaborators ?? []).filter(c => c.user_id !== userId) }));
    } catch (err) {
      toast.error(errMsg(err, "Error removing collaborator"));
    }
  }

  async function saveTournamentDetails(patch) {
    try {
      const res = await api.patch(`/tournaments/${id}`, patch);
      setTournament(res.data);
      setEditOpen(false);
      toast.success("Tournament details updated");
    } catch (err) {
      toast.error(errMsg(err, "Error updating tournament"));
    }
  }

  if (loading || !tournament) return (
    <div className="page"><div className="loading-block"><span className="spinner" /> Loading tournament…</div></div>
  );

  const groupNames = [...new Set(teams.map(t => t.group_name).filter(Boolean))].sort();
  const teamsByGroup = groupNames.reduce((acc, g) => {
    acc[g] = teams.filter(t => t.group_name === g);
    return acc;
  }, {});
  const ungrouped = teams.filter(t => !t.group_name);
  const getStanding = (teamId) => standings.find(s => s.team_id === teamId);
  const teamName = (teamId) => teams.find(t => t.id === teamId)?.name || `Team ${teamId}`;
  const groupColor = (g) => GROUP_COLORS[g?.charCodeAt(0) - 65] || "#667085";

  const knockoutPhases = formatSpec
    ? formatSpec.phases.filter(p => !p.is_group_stage).sort((a, b) => a.order - b.order)
    : [];
  const phaseOrderIndex = (key) => {
    if (!formatSpec) return 99;
    const p = formatSpec.phases.find(x => x.key === key);
    return p ? p.order : 99;
  };
  const phaseLabel = (key) =>
    formatSpec?.phases.find(p => p.key === key)?.label
    || PHASE_LABEL_FALLBACK[key]
    || key;

  const teamGroup = (teamId) => teams.find(t => t.id === teamId)?.group_name;
  const teamById = (teamId) => teams.find(t => t.id === teamId);

  const computeRecord = (teamId, matchList) => {
    let W = 0, D = 0, L = 0;
    for (const m of matchList) {
      if (m.status !== "finished" || m.phase !== "group_stage") continue;
      const isHome = m.home_team_id === teamId;
      const isAway = m.away_team_id === teamId;
      if (!isHome && !isAway) continue;
      const my = isHome ? m.score_home : m.score_away;
      const op = isHome ? m.score_away : m.score_home;
      if (my > op) W++;
      else if (my < op) L++;
      else D++;
    }
    return { W, D, L, P: W + D + L };
  };

  const matchSections = (() => {
    const fixturesByDate = new Map();   // all upcoming/scheduled (dated and undated both)
    const finishedByDate = new Map();   // all finished matches
    for (const m of matches) {
      if (m.status === "finished") {
        const key = m.match_date || "";
        if (!finishedByDate.has(key)) finishedByDate.set(key, []);
        finishedByDate.get(key).push(m);
      } else {
        const key = m.match_date || "";
        if (!fixturesByDate.has(key)) fixturesByDate.set(key, []);
        fixturesByDate.get(key).push(m);
      }
    }
    const sortByPhase = items => items.slice().sort((a, b) => phaseOrderIndex(a.phase) - phaseOrderIndex(b.phase));
    const fixtures = [...fixturesByDate.entries()]
      .map(([date, items]) => ({ date, items: sortByPhase(items) }))
      .sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
    const results = [...finishedByDate.entries()]
      .map(([date, items]) => ({ date, items: sortByPhase(items) }))
      .sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
    return { fixtures, results };
  })();

  function dateSectionLabel(dateStr) {
    if (!dateStr) return "Unscheduled";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + "T00:00:00");
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  }

  const fixtureCount = matches.filter(m => m.status !== "finished").length;
  const resultCount = matches.filter(m => m.status === "finished").length;

  const tabs = [
    { id: "groups", label: "Groups" },
    { id: "knockout", label: "Knockout" },
    { id: "fixtures", label: `Fixtures${fixtureCount ? ` (${fixtureCount})` : ""}` },
    { id: "results", label: `Results${resultCount ? ` (${resultCount})` : ""}` },
    { id: "all", label: "Teams" },
    ...(isCreator ? [{ id: "permissions", label: "Permissions" }] : []),
  ];

  return (
    <div className="page">
      {resultForm.useModal && resultForm.matchId && (
        <ResultModal
          match={matches.find(m => m.id === resultForm.matchId)}
          teamName={teamName}
          phaseLabel={phaseLabel}
          resultForm={resultForm}
          setResultForm={setResultForm}
          submitResult={submitResult}
        />
      )}

      {editOpen && (
        <EditTournamentModal
          tournament={tournament}
          onClose={() => setEditOpen(false)}
          onSave={saveTournamentDetails}
        />
      )}

      <button className="btn btn-ghost" style={{ marginBottom: 20, fontSize: 13 }} onClick={() => navigate("/")}>
        ← Back to Tournaments
      </button>

      {(() => {
        const totalMatches = matches.length;
        const finishedMatches = matches.filter(m => m.status === "finished").length;
        const pct = totalMatches > 0 ? Math.round((finishedMatches / totalMatches) * 100) : 0;
        const finalMatch = matches.find(m => m.phase === "final" && m.status === "finished");
        const championId = (() => {
          if (!finalMatch) return null;
          if (finalMatch.score_home > finalMatch.score_away) return finalMatch.home_team_id;
          if (finalMatch.score_away > finalMatch.score_home) return finalMatch.away_team_id;
          // Draw at full time — decided on penalties.
          if (finalMatch.pen_home != null && finalMatch.pen_away != null && finalMatch.pen_home !== finalMatch.pen_away)
            return finalMatch.pen_home > finalMatch.pen_away ? finalMatch.home_team_id : finalMatch.away_team_id;
          return null;
        })();
        const champion = championId ? teamName(championId) : null;
        const phaseInProgress = (() => {
          const ph = ["final", "semi_final", "quarter_final", "round_of_16", "group_stage"];
          for (const p of ph) if (matches.some(m => m.phase === p)) return p;
          return null;
        })();
        return (
          <>
            {champion && (() => {
              const homeWon = championId === finalMatch.home_team_id;
              const onPens = finalMatch.score_home === finalMatch.score_away;
              return (
                <section style={s.winner}>
                  <div style={s.winnerAccent} />
                  <div style={s.winnerLeft}>
                    <TrophyIcon style={s.winnerTrophy} />
                    <div>
                      <div style={s.label}>Tournament Winner</div>
                      <div style={s.winnerTitle}>{champion}</div>
                    </div>
                  </div>
                  <div style={s.winnerRight}>
                    <div style={s.label}>Final Score</div>
                    <div style={s.scoreText}>
                      <span style={{ color: homeWon ? "var(--ink)" : "var(--muted)", fontWeight: homeWon ? 600 : 500 }}>
                        {teamName(finalMatch.home_team_id)}
                      </span>
                      <span style={{ color: "var(--ink)", margin: "0 8px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {finalMatch.score_home} – {finalMatch.score_away}
                        {onPens && (
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gold)", marginLeft: 6 }}>
                            ({finalMatch.pen_home}–{finalMatch.pen_away} pens)
                          </span>
                        )}
                      </span>
                      <span style={{ color: !homeWon ? "var(--ink)" : "var(--muted)", fontWeight: !homeWon ? 600 : 500 }}>
                        {teamName(finalMatch.away_team_id)}
                      </span>
                    </div>
                  </div>
                </section>
              );
            })()}

            <section style={{ ...s.shadowCard, ...s.tournamentHeader }}>
              <div style={s.headerLeft}>
                <div style={s.logoShield}>
                  {(() => {
                    const words = tournament.name.split(/\s+/).filter(Boolean);
                    return (words.length > 1
                      ? words.map(w => w[0]).join("").slice(0, 3)
                      : (words[0] || "—").slice(0, 4)
                    ).toUpperCase();
                  })()}
                </div>
                <div>
                  <div style={s.titleRow}>
                    <h1 style={s.titleBig}>{tournament.name}</h1>
                    {isCreator && (
                      <button style={s.editBtn} onClick={() => setEditOpen(true)}>Edit details</button>
                    )}
                  </div>
                  <div style={s.metaRow}>
                    {phaseInProgress && <span style={s.greenBadge}>{phaseLabel(phaseInProgress)}</span>}
                    {tournament.location && <span style={s.metaItem}>{tournament.location}</span>}
                    <span style={s.metaItem}>{teams.length} teams</span>
                    <span style={s.metaItem}>{groupNames.length} groups</span>
                  </div>
                  {totalMatches > 0 && !champion && (
                    <div style={{ marginTop: 14, maxWidth: 420 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={s.label}>Progress</span>
                        <span style={{ fontSize: 12, color: "var(--ink)", fontWeight: 620, fontVariantNumeric: "tabular-nums" }}>
                          {finishedMatches}/{totalMatches} · {pct}%
                        </span>
                      </div>
                      <div style={{ height: 6, background: "var(--surface3)", borderRadius: 99, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(16,24,40,.06)" }}>
                        <div style={{
                          width: `${pct}%`, height: "100%", borderRadius: 99,
                          background: "linear-gradient(90deg, var(--accent-lt), var(--accent-dk))",
                          boxShadow: "0 1px 4px -1px rgba(var(--accent-rgb),.5)",
                          transition: "width .5s var(--ease)",
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {canEdit && (
                <form style={s.addTeamInline} onSubmit={addTeam}>
                  <label style={s.logoPicker} title={teamForm.logo_url ? "Change logo" : "Upload logo"}>
                    {teamForm.logo_url ? (
                      <img src={teamForm.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={s.logoPickerHint}>Logo</span>
                    )}
                    <input type="file" accept="image/*" hidden onChange={handleLogoFile} />
                  </label>
                  {teamForm.logo_url && (
                    <button type="button"
                      onClick={() => setTeamForm(f => ({ ...f, logo_url: "" }))}
                      style={s.logoClearBtn}
                      title="Remove logo">✕</button>
                  )}
                  <input style={s.addTeamInput} placeholder="Team name"
                    value={teamForm.name}
                    onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} required />
                  <input style={s.addTeamSmall} maxLength={2}
                    value={teamForm.group_name}
                    onChange={e => setTeamForm(f => ({ ...f, group_name: e.target.value.toUpperCase() }))} />
                  <button type="submit" style={s.primaryBtn}>+ Add Team</button>
                  <span style={{ flexBasis: "100%", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {formatSpec
                      ? `This format uses ${formatSpec.group_count} groups (A–${String.fromCharCode(64 + formatSpec.group_count)}), pairing A–B, C–D, E–F, G–H for the knockout draw.`
                      : "Groups pair up as A–B, C–D, E–F, G–H — use 2, 4 or 8 groups for a complete bracket."}
                  </span>
                </form>
              )}
            </section>
          </>
        );
      })()}

      {(() => {
        const prizes = [
          { key: "prize_first",  rank: "01", place: "First Place",  color: "var(--gold)", bg: "rgba(180,83,9,.15)" },
          { key: "prize_second", rank: "02", place: "Second Place", color: "#64748b",      bg: "rgba(100,116,139,.14)" },
          { key: "prize_third",  rank: "03", place: "Third Place",  color: "#92400e",      bg: "rgba(146,64,14,.14)" },
          { key: "prize_fourth", rank: "04", place: "Fourth Place", color: "var(--muted)", bg: "rgba(102,112,133,.12)" },
        ];
        const hasAnyPrize = tournament.prize_pool != null
          || prizes.some(p => tournament[p.key] != null);
        if (!hasAnyPrize) return null;
        return (
          <section style={{ ...s.shadowCard, ...s.prizeCardWrap }}>
            <div style={s.prizeTop}>
              <div>
                <div style={s.label}>Prize Distribution</div>
                <h2 style={s.sectionTitle}>Prizes & Pool</h2>
              </div>
              {tournament.prize_pool != null && (
                <div>
                  <div style={s.label}>Total Pool</div>
                  <div style={s.poolValue}>€{tournament.prize_pool.toLocaleString()}</div>
                </div>
              )}
            </div>
            <div className="prize-grid" style={s.prizeGrid}>
              {prizes.map((p, i) => {
                const value = tournament[p.key];
                const isSet = value != null;
                return (
                  <div key={p.key} style={{
                    ...s.prizeItem,
                    borderRight: i < prizes.length - 1 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ ...s.label, color: p.color }}>{p.place}</div>
                      <span style={{
                        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                        display: "inline-grid", placeItems: "center",
                        background: p.bg, color: p.color,
                        fontWeight: 660, fontSize: 13, fontVariantNumeric: "tabular-nums",
                      }}>{i + 1}</span>
                    </div>
                    <div style={{
                      ...s.prizeAmount, marginTop: 14,
                      color: isSet ? (p.rank === "01" ? p.color : "var(--text)") : "var(--muted)",
                    }}>
                      {isSet ? `€${value.toLocaleString()}` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      <div className="tab-bar">
        {tabs.map(tab => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Groups ── */}
      {activeTab === "groups" && (
        <div className="groups-grid" style={s.groupsGrid}>
          {groupNames.map(g => {
            const groupTeams = teamsByGroup[g] || [];
            const color = groupColor(g);
            return (
              <div key={g} style={{ ...s.shadowCard, ...s.groupCardWrap, borderTop: `3px solid ${color}` }}>
                <div style={s.groupHead}>
                  <span style={{ ...s.groupLetter, color }}>Group {g}</span>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{groupTeams.length} teams</span>
                </div>
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th>#</th><th style={{ textAlign: "left" }}>Team</th>
                      <th>P</th><th>W</th><th>D</th><th>L</th>
                      <th>GF</th><th>GA</th><th>GD</th><th>PTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTeams
                      .map(t => {
                        const st = getStanding(t.id);
                        const rec = computeRecord(t.id, matches);
                        return { team: t, standing: st, rec };
                      })
                      .sort((a, b) => (b.standing?.points ?? 0) - (a.standing?.points ?? 0)
                        || (b.standing?.goal_diff ?? 0) - (a.standing?.goal_diff ?? 0))
                      .map(({ team: t, standing: st, rec }, i) => {
                        const inAdvancingRank = formatSpec && i < formatSpec.advancing_per_group;
                        return (
                        <tr key={t.id} style={inAdvancingRank ? s.advancingRow : {}}>
                          <td>
                            <span style={{
                              width: 28, height: 28, borderRadius: 9,
                              display: "inline-grid", placeItems: "center",
                              background: inAdvancingRank
                                ? "linear-gradient(160deg, rgba(var(--accent-rgb),.18), rgba(var(--accent-rgb),.08))"
                                : "var(--surface2)",
                              boxShadow: inAdvancingRank ? "inset 0 0 0 1px rgba(var(--accent-rgb),.18)" : "none",
                              color: inAdvancingRank ? "var(--accent)" : "var(--faint)",
                              fontWeight: 660, fontSize: 12.5, fontVariantNumeric: "tabular-nums",
                            }}>{i + 1}</span>
                          </td>
                          <td style={{ fontWeight: 600, color: "var(--ink)", letterSpacing: "-.012em" }}>
                            {t.name}
                            {inAdvancingRank && (
                              <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 550, marginLeft: 7 }}>↑ advances</span>
                            )}
                          </td>
                          <td style={s.statCell}>{rec.P}</td>
                          <td style={s.statCell}>{rec.W}</td>
                          <td style={s.statCell}>{rec.D}</td>
                          <td style={s.statCell}>{rec.L}</td>
                          <td style={s.statCell}>{st?.goals_scored ?? 0}</td>
                          <td style={s.statCell}>{st?.goals_conceded ?? 0}</td>
                          <td style={{ ...s.statCell, color: (st?.goal_diff ?? 0) > 0 ? "var(--accent)" : (st?.goal_diff ?? 0) < 0 ? "var(--red)" : "var(--faint)", fontWeight: 600 }}>
                            {(st?.goal_diff ?? 0) > 0 ? "+" : ""}{st?.goal_diff ?? 0}
                          </td>
                          <td style={{
                            ...s.statCell,
                            fontWeight: 700, fontSize: 15, letterSpacing: "-.02em",
                            color: (st?.points ?? 0) >= 7 ? "var(--accent)" : (st?.points ?? 0) <= 4 ? "var(--orange)" : "var(--ink)",
                          }}>{st?.points ?? 0}</td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
                <div style={s.qualLegend}>
                  <span style={s.legendItem}>
                    <span style={{ color: "var(--accent)", fontSize: 12 }}>■</span>
                    Qualified for Knockout
                  </span>
                  <span style={s.legendItem}>
                    <span style={{ color: "var(--orange)", fontSize: 12 }}>■</span>
                    Possible Qualification
                  </span>
                </div>
                {canEdit && (
                  <div style={s.groupMoveRow}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Move team to group:</span>
                    {groupTeams.map(t => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 13, color: "var(--text)", minWidth: 80 }}>{t.name}</span>
                        <input className="input"
                          style={{ width: 54, textAlign: "center", textTransform: "uppercase", padding: "4px 8px", fontSize: 13 }}
                          defaultValue={t.group_name || ""} maxLength={2}
                          onBlur={e => { const v = e.target.value.toUpperCase(); if (v && v !== t.group_name) updateTeamGroup(t.id, v); }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {ungrouped.length > 0 && (
            <div style={s.groupCard}>
              <div style={{ ...s.groupHeader, borderColor: "var(--muted)" }}>
                <span style={{ color: "var(--muted)", fontWeight: 700 }}>Unassigned</span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{ungrouped.length} teams</span>
              </div>
              {ungrouped.map(t => (
                <div key={t.id} style={s.ungroupedRow}>
                  <span style={{ fontWeight: 500 }}>{t.name}</span>
                  {canEdit && (
                    <input className="input"
                      style={{ width: 70, textAlign: "center", textTransform: "uppercase", padding: "4px 8px", fontSize: 13 }}
                      placeholder="Group" maxLength={2}
                      onBlur={e => { const v = e.target.value.toUpperCase(); if (v) updateTeamGroup(t.id, v); }} />
                  )}
                </div>
              ))}
            </div>
          )}
          {groupNames.length === 0 && ungrouped.length === 0 && (
            <div className="empty">No teams yet. Add teams and assign them to groups.</div>
          )}
        </div>
      )}

      {/* ── Knockout Bracket ── */}
      {activeTab === "knockout" && (
        <div>
          <KnockoutBracket
            phases={knockoutPhases}
            phaseLabel={phaseLabel}
            matches={matches}
            teamName={teamName}
            isOrganizer={canEdit}
            setResultForm={setResultForm}
            dateEdit={dateEdit}
            setDateEdit={setDateEdit}
            saveMatchDate={saveMatchDate}
          />
        </div>
      )}

      {/* ── Fixtures (scheduled matches) ── */}
      {activeTab === "fixtures" && (
        <div>
          {matchSections.fixtures.length === 0 ? (
            <div className="empty">
              {canEdit
                ? "No fixtures yet. Add teams to groups and matches will be scheduled automatically."
                : "Fixtures will appear here once the organizer assigns dates."}
            </div>
          ) : (
            <MatchesGroup title="Fixtures" accent="var(--accent)" subtitle="Upcoming matches">
              {matchSections.fixtures.map(({ date, items }) => (
                <DateSection key={`fx-${date || "tbd"}`} date={date} items={items}
                  dateSectionLabel={dateSectionLabel}
                  countLabel={`${items.length} match${items.length !== 1 ? "es" : ""}`}
                  accent="var(--accent)"
                  borderColor="rgba(var(--accent-rgb),.2)"
                  teamName={teamName} teamById={teamById} teamGroup={teamGroup} phaseLabel={phaseLabel}
                  canEdit={canEdit} resultForm={resultForm} setResultForm={setResultForm}
                  submitResult={submitResult} dateEdit={dateEdit} setDateEdit={setDateEdit}
                  saveMatchDate={saveMatchDate} />
              ))}
            </MatchesGroup>
          )}
        </div>
      )}

      {/* ── Results (finished matches) ── */}
      {activeTab === "results" && (() => {
        const finished = matches.filter(m => m.status === "finished");
        const availablePhases = [...new Set(finished.map(m => m.phase))]
          .sort((a, b) => phaseOrderIndex(a) - phaseOrderIndex(b));
        const availableDates = [...new Set(finished.filter(m => m.match_date).map(m => m.match_date))].sort();

        const filteredSections = matchSections.results
          .map(({ date, items }) => ({
            date,
            items: items.filter(m =>
              (!resultsFilter.phase || m.phase === resultsFilter.phase) &&
              (!resultsFilter.date || m.match_date === resultsFilter.date)
            ),
          }))
          .filter(({ items }) => items.length > 0);

        const totalShown = filteredSections.reduce((sum, s) => sum + s.items.length, 0);
        const isFiltered = !!(resultsFilter.phase || resultsFilter.date);

        const formatDateOption = (d) =>
          new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

        return (
          <div>
            {matchSections.results.length === 0 ? (
              <div className="empty">No results yet — finished matches will show up here.</div>
            ) : (
              <>
                <div style={s.resultsToolbar}>
                  <div style={s.resultsFilterGroup}>
                    <span style={s.resultsFilterLabel}>Stage</span>
                    <select
                      className="select"
                      style={{ height: 38, width: "auto", minWidth: 180 }}
                      value={resultsFilter.phase ?? ""}
                      onChange={e => setResultsFilter(f => ({ ...f, phase: e.target.value || null }))}
                    >
                      <option value="">All stages</option>
                      {availablePhases.map(p => (
                        <option key={p} value={p}>{phaseLabel(p)}</option>
                      ))}
                    </select>
                  </div>
                  <div style={s.resultsFilterGroup}>
                    <span style={s.resultsFilterLabel}>Date</span>
                    <select
                      className="select"
                      style={{ height: 38, width: "auto", minWidth: 220 }}
                      value={resultsFilter.date ?? ""}
                      onChange={e => setResultsFilter(f => ({ ...f, date: e.target.value || null }))}
                    >
                      <option value="">All dates</option>
                      {availableDates.map(d => (
                        <option key={d} value={d}>{formatDateOption(d)}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                      {totalShown} of {finished.length} match{finished.length !== 1 ? "es" : ""}
                    </span>
                    {isFiltered && (
                      <button
                        className="btn btn-ghost"
                        style={{ height: 38, padding: "0 14px", fontSize: 13 }}
                        onClick={() => setResultsFilter({ phase: null, date: null })}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>

                {filteredSections.length === 0 ? (
                  <div className="empty">No results match these filters.</div>
                ) : (
                  <MatchesGroup title="Results" accent="var(--muted)" subtitle={isFiltered ? "Filtered" : "Finished matches"}>
                    {filteredSections.map(({ date, items }) => (
                      <DateSection key={`res-${date || "x"}`} date={date} items={items}
                        dateSectionLabel={dateSectionLabel}
                        countLabel={`${items.length} played`}
                        accent="var(--muted)"
                        borderColor="rgba(100,116,139,.25)"
                        teamName={teamName} teamById={teamById} teamGroup={teamGroup} phaseLabel={phaseLabel}
                        canEdit={canEdit} resultForm={resultForm} setResultForm={setResultForm}
                        submitResult={submitResult} dateEdit={dateEdit} setDateEdit={setDateEdit}
                        saveMatchDate={saveMatchDate} />
                    ))}
                  </MatchesGroup>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ── All Teams ── */}
      {activeTab === "all" && (
        <div style={s.teamList}>
          {teams.length === 0 && <div className="empty">No teams yet.</div>}
          {[...teams]
            .sort((a, b) => {
              const sa = getStanding(a.id), sb = getStanding(b.id);
              return (sb?.points ?? 0) - (sa?.points ?? 0)
                || (sb?.goal_diff ?? 0) - (sa?.goal_diff ?? 0);
            })
            .map((t, i) => (
            <div key={t.id}>
              <div style={s.teamRow}>
                <span style={s.teamNum}>{i + 1}</span>
                <span style={{ fontWeight: 500, flex: 1 }}>{t.name}</span>
                {t.group_name && (
                  <span className="badge" style={{ fontSize: 11, background: groupColor(t.group_name) + "22", color: groupColor(t.group_name), border: `1px solid ${groupColor(t.group_name)}44` }}>
                    Group {t.group_name}
                  </span>
                )}
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => toggleRoster(t.id)}>
                  Players {rosterOpen === t.id ? "▴" : "▾"}
                </button>
              </div>
              {rosterOpen === t.id && (
                <div style={s.rosterPanel}>
                  {(rosters[t.id] || []).length === 0 && (
                    <div style={{ color: "var(--muted)", fontSize: 13, fontStyle: "italic", padding: "4px 0" }}>
                      No players added yet.
                    </div>
                  )}
                  {(rosters[t.id] || []).map((p, pi) => (
                    <div key={p.id} style={s.rosterRow}>
                      <span style={{ color: "var(--muted)", fontSize: 12, width: 22, fontVariantNumeric: "tabular-nums" }}>{pi + 1}</span>
                      <span style={{ flex: 1, fontSize: 14 }}>{p.name}</span>
                      {canEdit && (
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => removePlayer(t.id, p.id)} title="Remove player">✕</button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <form
                      style={{ display: "flex", gap: 8, marginTop: 10 }}
                      onSubmit={e => { e.preventDefault(); addPlayer(t.id); }}
                    >
                      <input className="input" style={{ maxWidth: 260, fontSize: 13, padding: "6px 10px" }}
                        placeholder="Player name"
                        value={playerName}
                        onChange={e => setPlayerName(e.target.value)} />
                      <button className="btn btn-secondary" type="submit" style={{ fontSize: 13, padding: "6px 14px" }}>
                        Add
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Permissions ── */}
      {activeTab === "permissions" && isCreator && (
        <div style={s.permissionsCard}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Editing Permissions</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0, marginBottom: 18 }}>
            You created this tournament. Other organizers cannot edit it unless you grant them access here.
          </p>

          <form onSubmit={addCollaborator} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input
              className="input"
              type="email"
              placeholder="organizer@example.com"
              value={collabEmail}
              onChange={e => setCollabEmail(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
              required
            />
            <button className="btn btn-primary" type="submit">+ Grant Access</button>
          </form>

          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 8 }}>
            People with edit access
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={s.collabRow}>
              <span style={{ fontWeight: 500 }}>{currentUser?.email || "You"}</span>
              <span className="badge badge-gold" style={{ fontSize: 11 }}>Creator</span>
            </div>
            {(permissions?.collaborators ?? []).map(c => (
              <div key={c.user_id} style={s.collabRow}>
                <span style={{ fontWeight: 500 }}>{c.email}</span>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => removeCollaborator(c.user_id)}>
                  Revoke
                </button>
              </div>
            ))}
            {(permissions?.collaborators ?? []).length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, fontStyle: "italic" }}>
                No additional editors. Add an organizer's email above to share editing access.
              </div>
            )}
          </div>
        </div>
      )}

      <section className="info-grid" style={{ ...s.shadowCard, ...s.footerInfo }}>
        {[
          ["calendar", "Date",            "TBA"],
          ["groups",   "Format",          formatSpec?.label || "—"],
          ["clock",    "Match Duration", "2 × 20 min"],
          ["pin",      "Location",        tournament.location || "—"],
        ].map(([icon, label, value]) => (
          <div key={label} style={s.infoItem}>
            <div style={s.iconCircle}><InfoIcon kind={icon} /></div>
            <div>
              <div style={s.label}>{label}</div>
              <div style={{ marginTop: 6, fontSize: 16, color: "var(--text)", fontWeight: 600 }}>{value}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function TrophyIcon({ style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={style}>
      <path d="M7 3h10v6a5 5 0 0 1-5 5 5 5 0 0 1-5-5V3Z" stroke="var(--gold-bright)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 4.5H4.75A1.75 1.75 0 0 0 3 6.25v.75A3.5 3.5 0 0 0 6.5 10.5H7" stroke="var(--gold-bright)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 4.5h2.25A1.75 1.75 0 0 1 21 6.25v.75a3.5 3.5 0 0 1-3.5 3.5H17" stroke="var(--gold-bright)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 14v3.5M9 21h6M9.4 21c.1-1.4.7-2.6 1.4-3.5h2.4c.7.9 1.3 2.1 1.4 3.5" stroke="var(--gold-bright)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const INFO_ICON_PATHS = {
  calendar: <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17" />
    <path d="M8 3v3M16 3v3" />
  </>,
  groups: <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
  </>,
  clock: <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3.2 2" />
  </>,
  pin: <>
    <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
    <circle cx="12" cy="9" r="2.4" />
  </>,
};

function InfoIcon({ kind }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {INFO_ICON_PATHS[kind]}
    </svg>
  );
}

/* ── Knockout Bracket ── */
function KnockoutBracket({ phases, phaseLabel, matches, teamName, isOrganizer, setResultForm, dateEdit, setDateEdit, saveMatchDate }) {
  const B = "2px solid rgba(16,24,40,.22)";
  const BA = "2px solid rgba(var(--accent-rgb),.6)";

  if (phases.length === 0) {
    return <div className="empty">Knockout phase not available for this format.</div>;
  }

  // Small tournaments start their bracket at a later phase (e.g. 2 groups seed
  // straight into the semi finals) — hide the earlier, never-used rounds.
  const firstUsedIdx = phases.findIndex(p => matches.some(m => m.phase === p.key));
  const visiblePhases = firstUsedIdx > 0 ? phases.slice(firstUsedIdx) : phases;

  // Place each match at its bracket slot: the first round is id-ordered
  // (id-adjacent matches are true pairs), and every later match sits at the
  // slot of the feeder pair its teams came from — so winners always meet in
  // the match drawn directly next to theirs. Mirrors the backend's
  // bracket_ordered_matches in services/advance.py.
  const phaseColumns = [];
  visiblePhases.forEach((p, k) => {
    const phaseMatches = matches.filter(m => m.phase === p.key).sort((a, b) => a.id - b.id);
    let items;
    if (k === 0) {
      const slotCount = p.slots ?? Math.max(phaseMatches.length, 1);
      items = [...phaseMatches, ...Array(Math.max(0, slotCount - phaseMatches.length)).fill(null)].slice(0, slotCount);
    } else {
      const prev = phaseColumns[k - 1].items;
      const pairCount = Math.max(1, Math.floor(prev.length / 2));
      items = Array(pairCount).fill(null);
      const teamToPair = new Map();
      prev.forEach((m, i) => {
        if (m) {
          teamToPair.set(m.home_team_id, Math.floor(i / 2));
          teamToPair.set(m.away_team_id, Math.floor(i / 2));
        }
      });
      const leftovers = [];
      for (const m of phaseMatches) {
        const j = teamToPair.get(m.home_team_id) ?? teamToPair.get(m.away_team_id);
        if (j != null && j < pairCount && items[j] == null) items[j] = m;
        else leftovers.push(m);
      }
      for (const m of leftovers) {
        const empty = items.findIndex(x => x == null);
        if (empty >= 0) items[empty] = m;
      }
    }
    phaseColumns.push({ ...p, items });
  });

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 520, gap: 0 }}>
          {phaseColumns.map((col, ci) => {
            const isFinal = ci === phaseColumns.length - 1 && col.items.length === 1;
            const next = phaseColumns[ci + 1];
            const showConnector = next && col.items.length === next.items.length * 2;
            const connectorPairs = next ? next.items.length : 0;
            return (
              <div key={col.key} style={{ display: "flex" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={bk.colTitle}>{col.label}</div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: isFinal ? "center" : "space-around" }}>
                    {col.items.map((m, i) => (
                      <BracketCard key={i} match={m} teamName={teamName} isFinal={isFinal}
                        isOrganizer={isOrganizer}
                        setResultForm={setResultForm}
                        dateEdit={dateEdit} setDateEdit={setDateEdit} saveMatchDate={saveMatchDate} />
                    ))}
                  </div>
                </div>
                {next && (
                  <div style={{ width: 56, display: "flex", flexDirection: "column", paddingTop: 32 }}>
                    {showConnector
                      ? Array.from({ length: connectorPairs }).map((_, i) => {
                          const topDone = col.items[i * 2]?.status === "finished";
                          const bottomDone = col.items[i * 2 + 1]?.status === "finished";
                          return (
                            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                              <div style={{ flex: 1, borderBottom: topDone ? BA : B, borderRight: topDone ? BA : B, borderRadius: "0 0 8px 0" }} />
                              <div style={{ flex: 1, borderTop: bottomDone ? BA : B, borderRight: bottomDone ? BA : B, borderRadius: "0 8px 0 0" }} />
                            </div>
                          );
                        })
                      : <div style={{ flex: 1 }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {phaseLabel && null}
    </div>
  );
}

function BracketCard({ match, teamName, isFinal, isOrganizer, setResultForm, dateEdit, setDateEdit, saveMatchDate }) {
  const isFinished = match?.status === "finished";
  const wentToPens = isFinished && match.pen_home != null && match.pen_away != null;
  const homeWon = isFinished && (match.score_home > match.score_away || (wentToPens && match.pen_home > match.pen_away));
  const awayWon = isFinished && (match.score_away > match.score_home || (wentToPens && match.pen_away > match.pen_home));
  const editingDate = dateEdit?.matchId === match?.id;

  if (!match) {
    return (
      <div style={{ width: 226, flexShrink: 0 }}>
        <div style={{
          border: "1.5px dashed var(--border2)", borderRadius: 11, width: 226,
          background: "rgba(255,255,255,.45)", flexShrink: 0,
        }}>
          <div style={{ padding: "9px 12px", borderBottom: "1px dashed var(--border)", color: "var(--faint)", fontSize: 13, fontWeight: 500 }}>TBD</div>
          <div style={{ padding: "9px 12px", color: "var(--faint)", fontSize: 13, fontWeight: 500 }}>TBD</div>
        </div>
      </div>
    );
  }

  const homeName = teamName(match.home_team_id);
  const awayName = teamName(match.away_team_id);

  const dateLabel = match.match_date ? new Date(match.match_date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const dateTimeLabel = dateLabel
    ? (match.match_time ? `${dateLabel} · ${match.match_time}` : dateLabel)
    : null;

  return (
    <div style={{ width: 226, flexShrink: 0 }}>
      {isOrganizer && editingDate ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input className="input" type="date"
              style={{ fontSize: 11, padding: "2px 6px", flex: 1 }}
              value={dateEdit.value}
              onChange={e => setDateEdit(d => ({ ...d, value: e.target.value }))} />
            <input className="input" type="time"
              style={{ fontSize: 11, padding: "2px 6px", width: 80 }}
              value={dateEdit.time}
              onChange={e => setDateEdit(d => ({ ...d, time: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
            <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => saveMatchDate(match.id, dateEdit.value, dateEdit.time)}>Save</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 6px" }}
              onClick={() => setDateEdit({ matchId: null, value: "", time: "" })}>✕</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
          {dateTimeLabel && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 500 }}>{dateTimeLabel}</span>}
          {!dateTimeLabel && isOrganizer && <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>No date</span>}
          {isOrganizer && (
            <button onClick={() => setDateEdit({ matchId: match.id, value: match.match_date || "", time: match.match_time || "" })}
              style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 10, cursor: "pointer", padding: 0 }}>
              {dateTimeLabel ? "Edit" : "Set date"}
            </button>
          )}
        </div>
      )}
      <div style={{
        borderRadius: 11, overflow: "hidden", background: "var(--surface)",
        /* The final gets a ring in the accent, decided ties a soft one, and
           undecided cards just the neutral hairline. */
        boxShadow: isFinal
          ? "0 0 0 1.5px var(--accent), 0 6px 18px -6px rgba(var(--accent-rgb),.45), 0 1px 2px rgba(16,24,40,.06)"
          : isFinished
            ? "0 0 0 1px rgba(var(--accent-rgb),.3), 0 2px 8px -3px rgba(16,24,40,.12)"
            : "var(--shadow-xs)",
      }}>
        <div style={{ ...bk.slot, borderBottom: "1px solid var(--border)", ...(homeWon ? bk.slotWon : {}) }}>
          <span style={{ ...bk.slotName, ...(homeWon ? bk.slotNameWon : {}) }}>
            {homeName}
          </span>
          {isFinished && (
            <span style={{ ...bk.slotScore, color: homeWon ? "var(--accent)" : "var(--faint)" }}>
              {match.score_home}
              {wentToPens && (
                <span style={{ ...bk.penScore, color: homeWon ? "var(--gold)" : "var(--faint)" }}>
                  ({match.pen_home})
                </span>
              )}
            </span>
          )}
        </div>
        <div style={{ ...bk.slot, ...(awayWon ? bk.slotWon : {}) }}>
          <span style={{ ...bk.slotName, ...(awayWon ? bk.slotNameWon : {}) }}>
            {awayName}
          </span>
          {isFinished && (
            <span style={{ ...bk.slotScore, color: awayWon ? "var(--accent)" : "var(--faint)" }}>
              {match.score_away}
              {wentToPens && (
                <span style={{ ...bk.penScore, color: awayWon ? "var(--gold)" : "var(--faint)" }}>
                  ({match.pen_away})
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {wentToPens && (
        <div style={{
          fontSize: 10, fontWeight: 700, color: "var(--gold)", textAlign: "center", marginTop: 4,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {teamName(homeWon ? match.home_team_id : match.away_team_id)} advances{" "}
          {Math.max(match.pen_home, match.pen_away)}–{Math.min(match.pen_home, match.pen_away)} on pens
        </div>
      )}

      {!isFinished && isOrganizer && (
        <button className="btn btn-secondary" style={{ width: "100%", fontSize: 12, padding: "5px 0", marginTop: 6, justifyContent: "center" }}
          onClick={() => setResultForm({ matchId: match.id, score_home: 0, score_away: 0, pen_home: "", pen_away: "", useModal: true })}>
          Enter Result
        </button>
      )}
      {isFinished && isOrganizer && (
        <button className="btn btn-ghost" style={{ width: "100%", fontSize: 11, padding: "4px 0", marginTop: 6, justifyContent: "center" }}
          onClick={() => setResultForm({
            matchId: match.id,
            score_home: match.score_home, score_away: match.score_away,
            pen_home: match.pen_home ?? "", pen_away: match.pen_away ?? "",
            useModal: true,
          })}>
          Edit Result
        </button>
      )}
    </div>
  );
}

/* ── Result entry modal (used by the bracket so result entry doesn't shift the layout) ── */
function ResultModal({ match, teamName, phaseLabel, resultForm, setResultForm, submitResult }) {
  if (!match) return null;
  const isKO = match.phase !== "group_stage";
  const home = parseInt(resultForm.score_home);
  const away = parseInt(resultForm.score_away);
  const showPens = isKO && !Number.isNaN(home) && !Number.isNaN(away) && home === away;

  function close() {
    setResultForm({ matchId: null, score_home: 0, score_away: 0, pen_home: "", pen_away: "", useModal: false });
  }

  return (
    <div style={rm.overlay} onClick={close}>
      <div style={rm.card} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <p style={rm.eyebrow}>{phaseLabel?.(match.phase) || match.phase}</p>
            <h3 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>
              {match.status === "finished" ? "Edit Result" : "Enter Result"}
            </h3>
          </div>
          <button onClick={close} style={rm.closeBtn} aria-label="Close">✕</button>
        </div>

        <div style={rm.teamsRow}>
          <span style={rm.teamName}>{teamName(match.home_team_id)}</span>
          <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>vs</span>
          <span style={{ ...rm.teamName, textAlign: "right" }}>{teamName(match.away_team_id)}</span>
        </div>

        <div style={rm.scoreRow}>
          <input className="input" style={rm.scoreInput} type="number" min={0} autoFocus
            value={resultForm.score_home}
            onChange={e => setResultForm(f => ({ ...f, score_home: e.target.value }))} />
          <span style={{ color: "var(--muted)", fontSize: 22, fontWeight: 300 }}>–</span>
          <input className="input" style={rm.scoreInput} type="number" min={0}
            value={resultForm.score_away}
            onChange={e => setResultForm(f => ({ ...f, score_away: e.target.value }))} />
        </div>

        {showPens && (
          <div style={{ marginTop: 18 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--gold)", margin: 0, marginBottom: 8, textAlign: "center" }}>
              Penalty Shootout
            </p>
            <div style={rm.scoreRow}>
              <input className="input" style={rm.scoreInput} type="number" min={0} placeholder="0"
                value={resultForm.pen_home}
                onChange={e => setResultForm(f => ({ ...f, pen_home: e.target.value }))} />
              <span style={{ color: "var(--muted)", fontSize: 22, fontWeight: 300 }}>–</span>
              <input className="input" style={rm.scoreInput} type="number" min={0} placeholder="0"
                value={resultForm.pen_away}
                onChange={e => setResultForm(f => ({ ...f, pen_away: e.target.value }))} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={() => submitResult(match.id)}>Save Result</button>
        </div>
      </div>
    </div>
  );
}

/* ── Edit tournament details modal ── */
function EditTournamentModal({ tournament, onClose, onSave }) {
  const [form, setForm] = useState({
    name: tournament.name ?? "",
    location: tournament.location ?? "",
    prize_pool: tournament.prize_pool ?? "",
    prize_first: tournament.prize_first ?? "",
    prize_second: tournament.prize_second ?? "",
    prize_third: tournament.prize_third ?? "",
    prize_fourth: tournament.prize_fourth ?? "",
  });

  function handleSave(e) {
    e.preventDefault();
    const toIntOrNull = (v) => v === "" || v === null || v === undefined ? null : parseInt(v, 10);
    const patch = {
      name: form.name.trim(),
      location: form.location.trim() || null,
      prize_pool: toIntOrNull(form.prize_pool),
      prize_first: toIntOrNull(form.prize_first),
      prize_second: toIntOrNull(form.prize_second),
      prize_third: toIntOrNull(form.prize_third),
      prize_fourth: toIntOrNull(form.prize_fourth),
    };
    onSave(patch);
  }

  return (
    <div style={rm.overlay} onClick={onClose}>
      <form style={{ ...rm.card, maxWidth: 540 }} onClick={e => e.stopPropagation()} onSubmit={handleSave}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <p style={rm.eyebrow}>Tournament Settings</p>
            <h3 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>Edit details</h3>
          </div>
          <button type="button" onClick={onClose} style={rm.closeBtn} aria-label="Close">✕</button>
        </div>

        <div className="modal-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 16 }}>
          <div className="field">
            <label className="field-label">Tournament Name</label>
            <input className="input" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="field">
            <label className="field-label">Location</label>
            <input className="input" placeholder="e.g. Skopje" value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 18 }}>
          <label className="field-label">Total Prize Pool (€)</label>
          <input className="input" type="number" min="0" step="50" placeholder="1000"
            value={form.prize_pool}
            onChange={e => setForm(f => ({ ...f, prize_pool: e.target.value }))} />
        </div>

        <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 12 }}>
            Prize Distribution
          </p>
          <div className="prize-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { key: "prize_first",  label: "1st" },
              { key: "prize_second", label: "2nd" },
              { key: "prize_third",  label: "3rd" },
              { key: "prize_fourth", label: "4th" },
            ].map(({ key, label }) => (
              <div className="field" key={key}>
                <label className="field-label">{label} (€)</label>
                <input className="input" type="number" min="0" step="50" placeholder="0"
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  );
}

const rm = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(15,23,41,.42)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 24,
    backdropFilter: "blur(6px) saturate(140%)",
    WebkitBackdropFilter: "blur(6px) saturate(140%)",
  },
  card: {
    background: "var(--surface)", border: "none",
    borderRadius: 18, padding: 26, width: "100%", maxWidth: 430,
    boxShadow: "0 0 0 1px rgba(16,24,40,.06), 0 8px 16px -6px rgba(16,24,40,.14), 0 32px 64px -16px rgba(16,24,40,.32)",
  },
  eyebrow: {
    fontSize: 12, fontWeight: 550, color: "var(--faint)", margin: 0,
  },
  closeBtn: {
    background: "transparent", border: "1px solid var(--border2)",
    color: "var(--muted)", borderRadius: 9, width: 30, height: 30,
    cursor: "pointer", fontSize: 14,
  },
  teamsRow: {
    display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 14,
    alignItems: "center", marginBottom: 20, padding: "14px 16px",
    background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12,
  },
  teamName: { fontSize: 15, fontWeight: 620, color: "var(--ink)", letterSpacing: "-.015em" },
  scoreRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 14 },
  scoreInput: {
    width: 72, height: 58,
    textAlign: "center", fontSize: 25, fontWeight: 680, letterSpacing: "-.03em",
  },
};

/* ── Section group (Upcoming / Awaiting date / Finished) ── */
function MatchesGroup({ title, subtitle, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 660, color: "var(--ink)", letterSpacing: "-.028em" }}>{title}</h2>
        {subtitle && <span style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 500 }}>{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

/* ── Single-date row of match cards ── */
function DateSection({
  date, items, dateSectionLabel, countLabel, accent, borderColor,
  teamName, teamById, teamGroup, phaseLabel, canEdit, resultForm, setResultForm,
  submitResult, dateEdit, setDateEdit, saveMatchDate,
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 11, borderBottom: `1px solid ${borderColor}` }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0, boxShadow: `0 0 0 3px ${borderColor}` }} />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 640, color: "var(--ink)", letterSpacing: "-.018em" }}>
          {dateSectionLabel(date)}
        </h3>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)", fontWeight: 550 }}>
          {countLabel}
        </span>
      </div>
      <div className="stack">
        {items.map(m => (
          <MatchCard key={m.id} match={m} teamName={teamName} teamById={teamById} teamGroup={teamGroup}
            phaseLabel={phaseLabel}
            isOrganizer={canEdit} resultForm={resultForm}
            setResultForm={setResultForm} submitResult={submitResult}
            dateEdit={dateEdit} setDateEdit={setDateEdit} saveMatchDate={saveMatchDate} />
        ))}
      </div>
    </div>
  );
}

/* ── Team logo (used by ResultCard) ── */
function TeamLogo({ team, size = 36 }) {
  const initial = (team?.name || "?")[0].toUpperCase();
  if (team?.logo_url) {
    return (
      <img
        src={team.logo_url}
        alt=""
        onError={(e) => { e.currentTarget.style.display = "none"; }}
        style={{
          width: size, height: size, objectFit: "cover",
          background: "var(--surface2)", border: "none",
          boxShadow: "0 0 0 1px var(--border), 0 1px 2px rgba(16,24,40,.06)",
          borderRadius: 9, flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size,
      display: "grid", placeItems: "center",
      background: "linear-gradient(160deg, var(--surface2), var(--surface3))",
      boxShadow: "inset 0 0 0 1px var(--border)",
      borderRadius: 9, color: "var(--muted)",
      fontSize: 13.5, fontWeight: 660, letterSpacing: "-.02em", flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

/* ── One team's line inside a ResultCard ── */
function ResultRow({ team, name, score, won, wonOnPens, pen }) {
  const accent = wonOnPens ? "var(--gold)" : "var(--accent)";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center",
      gap: 14, padding: "10px 0",
      borderLeft: won ? `3px solid ${accent}` : "3px solid transparent",
      paddingLeft: 12,
    }}>
      <TeamLogo team={team} />
      <span style={{
        fontSize: 15, fontWeight: won ? 660 : 520,
        color: won ? "var(--ink)" : "var(--text)",
        letterSpacing: "-.015em",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {pen != null && (
          <span style={{
            fontSize: 12, fontWeight: 550,
            color: wonOnPens ? "var(--gold)" : "var(--faint)",
          }}>({pen})</span>
        )}
        <span style={{
          fontSize: 21, fontWeight: 680,
          color: won ? accent : "var(--faint)",
          minWidth: 24, textAlign: "right",
          letterSpacing: "-.03em",
          fontVariantNumeric: "tabular-nums",
        }}>{score}</span>
      </div>
    </div>
  );
}

/* ── Finished match card (Results tab) ── */
function ResultCard({ m, homeTeam, awayTeam, homeName, awayName, homeWon, awayWon, homeWonOnPens, awayWonOnPens, phaseLabel, groupLabel, onEdit }) {
  const dateStr = m.match_date
    ? new Date(m.match_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "Unscheduled";
  const phaseTxt = phaseLabel ? phaseLabel(m.phase) : (PHASE_LABEL_FALLBACK[m.phase] || m.phase);
  const stageTxt = groupLabel ? `Group ${groupLabel}` : phaseTxt;
  const phaseColor = PHASE_COLORS[m.phase] || "#64748b";
  const decidedOnPens = homeWonOnPens || awayWonOnPens;

  return (
    <div className="result-card" style={rcs.card}>
      <div className="result-card-date" style={rcs.dateBlock}>
        <span style={rcs.dateText}>{dateStr}</span>
        {m.match_time && (
          <span style={rcs.timeText}>{m.match_time}</span>
        )}
        <span style={{ ...rcs.stageHint, color: phaseColor }}>{phaseTxt}</span>
      </div>

      <div className="result-card-divider" style={rcs.divider} />

      <div className="result-card-teams" style={rcs.teamsCol}>
        <ResultRow team={homeTeam} name={homeName} score={m.score_home} won={homeWon} wonOnPens={homeWonOnPens} pen={m.pen_home} />
        <div style={{ height: 1, background: "var(--border)" }} />
        <ResultRow team={awayTeam} name={awayName} score={m.score_away} won={awayWon} wonOnPens={awayWonOnPens} pen={m.pen_away} />
      </div>

      <div className="result-card-right" style={rcs.rightCol}>
        <span style={rcs.stagePill}>{stageTxt}</span>
        <span style={decidedOnPens ? rcs.afterPens : rcs.fullTime}>
          {decidedOnPens ? "After Penalties" : "Full Time"}
        </span>
        {onEdit && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px", justifyContent: "center" }} onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

const rcs = {
  card: {
    display: "grid",
    gridTemplateColumns: "180px 1px 1fr auto",
    alignItems: "center",
    gap: 18,
    background: "var(--surface)", border: "none",
    borderRadius: 14,
    boxShadow: "var(--shadow)",
    padding: "18px 24px",
    transition: "box-shadow .2s var(--ease)",
  },
  dateBlock: { display: "flex", flexDirection: "column", gap: 4 },
  dateText: {
    fontSize: 13, fontWeight: 550, color: "var(--muted)", letterSpacing: "-.005em",
  },
  timeText: {
    fontSize: 16, fontWeight: 600, color: "var(--ink)",
    fontVariantNumeric: "tabular-nums",
  },
  stageHint: {
    fontSize: 12, fontWeight: 500,
  },
  divider: { width: 1, alignSelf: "stretch", background: "var(--border)" },
  teamsCol: { display: "flex", flexDirection: "column" },
  rightCol: {
    display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
    paddingLeft: 14, borderLeft: "1px solid var(--border)",
    width: 150,
  },
  stagePill: {
    fontSize: 12, fontWeight: 500, color: "var(--muted)",
    textAlign: "center",
  },
  fullTime: {
    fontSize: 12, fontWeight: 500, color: "var(--accent)",
    background: "rgba(var(--accent-rgb),.06)",
    border: "1px solid rgba(var(--accent-rgb),.2)",
    padding: "3px 9px", borderRadius: 6,
    textAlign: "center",
  },
  afterPens: {
    fontSize: 12, fontWeight: 500, color: "var(--gold)",
    background: "rgba(161,98,7,.07)",
    border: "1px solid rgba(161,98,7,.22)",
    padding: "3px 9px", borderRadius: 6,
    textAlign: "center",
  },
};

/* ── Match Card (Matches tab) ── */
function MatchCard({ match: m, teamName, teamById, teamGroup, phaseLabel, isOrganizer, resultForm, setResultForm, submitResult, dateEdit, setDateEdit, saveMatchDate }) {
  const homeName = teamName(m.home_team_id);
  const awayName = teamName(m.away_team_id);
  const homeTeam = teamById?.(m.home_team_id);
  const awayTeam = teamById?.(m.away_team_id);
  const isFinished = m.status === "finished";
  const wentToPens = isFinished && m.pen_home != null && m.pen_away != null;
  const homeWonRegulation = isFinished && m.score_home > m.score_away;
  const awayWonRegulation = isFinished && m.score_away > m.score_home;
  const homeWonOnPens = wentToPens && m.pen_home > m.pen_away;
  const awayWonOnPens = wentToPens && m.pen_away > m.pen_home;
  const homeWon = homeWonRegulation || homeWonOnPens;
  const awayWon = awayWonRegulation || awayWonOnPens;
  const entering = resultForm.matchId === m.id;
  const editingDate = dateEdit?.matchId === m.id;
  const phaseColor = PHASE_COLORS[m.phase] || "#64748b";
  const groupLabel = m.phase === "group_stage" ? teamGroup?.(m.home_team_id) : null;

  if (isFinished) {
    return (
      <ResultCard
        m={m} homeTeam={homeTeam} awayTeam={awayTeam}
        homeName={homeName} awayName={awayName}
        homeWon={homeWon} awayWon={awayWon}
        homeWonOnPens={homeWonOnPens} awayWonOnPens={awayWonOnPens}
        phaseLabel={phaseLabel} groupLabel={groupLabel}
        onEdit={isOrganizer ? () => setResultForm({
          matchId: m.id,
          score_home: m.score_home, score_away: m.score_away,
          pen_home: m.pen_home ?? "", pen_away: m.pen_away ?? "",
          useModal: true,
        }) : null}
      />
    );
  }

  return (
    <div style={{ ...mc.card, ...(isFinished ? mc.finished : {}), borderLeftColor: phaseColor }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
        <span style={{ ...mc.stageBadge, background: phaseColor + "22", color: phaseColor, border: `1px solid ${phaseColor}44` }}>
          {phaseLabel ? phaseLabel(m.phase) : (PHASE_LABEL_FALLBACK[m.phase] || m.phase)}
          {groupLabel && ` · Group ${groupLabel}`}
        </span>
        {isOrganizer && (
          editingDate ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input className="input" type="date" style={{ fontSize: 12, padding: "4px 8px" }}
                value={dateEdit.value}
                onChange={e => setDateEdit(d => ({ ...d, value: e.target.value }))} />
              <input className="input" type="time" style={{ fontSize: 12, padding: "4px 8px", width: 110 }}
                value={dateEdit.time}
                onChange={e => setDateEdit(d => ({ ...d, time: e.target.value }))} />
              <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => saveMatchDate(m.id, dateEdit.value, dateEdit.time)}>Save</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() => setDateEdit({ matchId: null, value: "", time: "" })}>✕</button>
            </div>
          ) : (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => setDateEdit({ matchId: m.id, value: m.match_date || "", time: m.match_time || "" })}>
              {m.match_date ? "Change date" : "Set date"}
            </button>
          )
        )}
      </div>
      {!editingDate && m.match_time && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontVariantNumeric: "tabular-nums", letterSpacing: ".5px" }}>
          {m.match_time}
        </div>
      )}

      <div style={mc.row}>
        <span style={{ ...mc.team, ...(homeWon ? mc.winner : {}) }}>{homeName}</span>
        {isFinished ? (
          <div style={mc.scoreBox}>
            <span style={{ ...mc.score, ...(homeWon ? mc.winScore : {}) }}>{m.score_home}</span>
            <span style={mc.sep}>–</span>
            <span style={{ ...mc.score, ...(awayWon ? mc.winScore : {}) }}>{m.score_away}</span>
          </div>
        ) : (
          <span style={mc.vsLabel}>vs</span>
        )}
        <span style={{ ...mc.team, textAlign: "right", ...(awayWon ? mc.winner : {}) }}>{awayName}</span>
      </div>

      {isFinished && m.pen_home != null && m.pen_away != null && (
        <div style={{ textAlign: "center", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>{m.pen_home}–{m.pen_away}</strong> on penalties
        </div>
      )}

      {isFinished && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <span className="badge badge-green" style={{ fontSize: 11 }}>
            {m.pen_home != null ? "After Penalties" : "Full Time"}
          </span>
        </div>
      )}

      {!isFinished && isOrganizer && (
        entering ? (
          <div>
            <div style={mc.enterRow}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Score:</span>
              <input style={mc.scoreInput} type="number" min={0} value={resultForm.score_home}
                onChange={e => setResultForm(f => ({ ...f, score_home: e.target.value }))} />
              <span style={{ color: "var(--muted)" }}>:</span>
              <input style={mc.scoreInput} type="number" min={0} value={resultForm.score_away}
                onChange={e => setResultForm(f => ({ ...f, score_away: e.target.value }))} />
            </div>
            {m.phase !== "group_stage" && parseInt(resultForm.score_home) === parseInt(resultForm.score_away) && (
              <div style={{ ...mc.enterRow, marginTop: 8 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Penalties:</span>
                <input style={mc.scoreInput} type="number" min={0} placeholder="0" value={resultForm.pen_home}
                  onChange={e => setResultForm(f => ({ ...f, pen_home: e.target.value }))} />
                <span style={{ color: "var(--muted)" }}>:</span>
                <input style={mc.scoreInput} type="number" min={0} placeholder="0" value={resultForm.pen_away}
                  onChange={e => setResultForm(f => ({ ...f, pen_away: e.target.value }))} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }}
                onClick={() => setResultForm({ matchId: null, score_home: 0, score_away: 0, pen_home: "", pen_away: "" })}>Cancel</button>
              <button className="btn btn-primary" style={{ fontSize: 13, padding: "6px 14px" }}
                onClick={() => submitResult(m.id)}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: "6px 14px" }}
              onClick={() => setResultForm({ matchId: m.id, score_home: 0, score_away: 0, pen_home: "", pen_away: "" })}>
              Enter Result
            </button>
          </div>
        )
      )}
    </div>
  );
}

const bk = {
  colTitle: {
    fontSize: 12, fontWeight: 620, color: "var(--muted)",
    letterSpacing: "-.005em",
    height: 34, display: "flex", alignItems: "center",
    padding: "0 8px", margin: 0,
  },
  scoreInput: {
    width: 44, padding: "4px 6px", textAlign: "center", fontSize: 14, fontWeight: 600,
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", outline: "none",
  },
  slot: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "9px 12px", gap: 8,
    background: "transparent",
  },
  /* Winner gets a tint plus an inset left bar — readable at a glance when the
     bracket is scanned as a whole rather than card by card. */
  slotWon: {
    background: "linear-gradient(90deg, rgba(var(--accent-rgb),.10), rgba(var(--accent-rgb),.03))",
    boxShadow: "inset 3px 0 0 var(--accent)",
  },
  slotName: {
    fontSize: 13.5, fontWeight: 520, color: "var(--text)",
    letterSpacing: "-.012em",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150,
  },
  slotNameWon: { fontWeight: 660, color: "var(--ink)" },
  slotScore: {
    fontSize: 16, fontWeight: 690, minWidth: 22, textAlign: "right",
    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em",
  },
  penScore: { fontSize: 11, fontWeight: 620, marginLeft: 4 },
};

const mc = {
  card: {
    background: "var(--surface)", border: "none",
    borderRadius: 14, padding: "16px 20px",
    borderLeft: "3px solid transparent",
    boxShadow: "var(--shadow)",
  },
  finished: { boxShadow: "0 0 0 1px rgba(var(--accent-rgb),.18), var(--shadow)" },
  row: { display: "flex", alignItems: "center", gap: 16 },
  stageBadge: {
    fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 99,
    letterSpacing: "-.005em",
  },
  team: { flex: 1, fontWeight: 520, fontSize: 15, letterSpacing: "-.012em" },
  winner: { color: "var(--ink)", fontWeight: 660 },
  scoreBox: { display: "flex", alignItems: "center", gap: 8 },
  score: { fontSize: 23, fontWeight: 680, color: "var(--faint)", minWidth: 26, textAlign: "center", fontVariantNumeric: "tabular-nums", letterSpacing: "-.03em" },
  winScore: { color: "var(--accent)" },
  sep: { fontSize: 17, fontWeight: 300, color: "var(--border2)" },
  vsLabel: { fontSize: 12, fontWeight: 620, color: "var(--faint)", padding: "4px 12px", background: "var(--surface2)", borderRadius: 99 },
  enterRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" },
  scoreInput: {
    width: 52, padding: "6px 8px", textAlign: "center", fontSize: 16, fontWeight: 700,
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, color: "var(--text)", outline: "none",
  },
};

const s = {
  shadowCard: {
    background: "var(--surface)",
    border: "none",
    borderRadius: 16,
    boxShadow: "var(--shadow-md)",
  },
  label: {
    fontSize: 12, color: "var(--faint)", fontWeight: 550, letterSpacing: "-.005em",
  },
  // ── Winner banner ──
  winner: {
    marginBottom: 24,
    borderRadius: 16,
    border: "none",
    overflow: "hidden",
    /* Warm gold wash fading to white — celebratory without a photo. */
    background: "linear-gradient(105deg, rgba(234,179,8,.13) 0%, rgba(234,179,8,.03) 34%, var(--surface) 68%)",
    backgroundColor: "var(--surface)",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "24px 28px",
    boxShadow: "var(--shadow-md)",
    position: "relative", flexWrap: "wrap", gap: 18,
  },
  winnerAccent: {
    position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
    background: "linear-gradient(180deg, #facc15, #a16207)",
  },
  winnerLeft: {
    display: "flex", alignItems: "center", gap: 18,
    flex: "1 1 280px", minWidth: 260,
  },
  winnerRight: {
    textAlign: "right",
    flex: "0 1 auto", minWidth: 200,
  },
  winnerTrophy: {
    width: 46, height: 46, flexShrink: 0,
    filter: "drop-shadow(0 2px 6px rgba(161,98,7,.3))",
  },
  winnerTitle: {
    marginTop: 3, fontSize: 27, fontWeight: 690,
    lineHeight: 1.15, color: "var(--ink)", letterSpacing: "-.032em",
  },
  scoreText: { fontSize: 15, fontWeight: 500, marginTop: 5, color: "var(--text)" },
  // ── Tournament header ──
  tournamentHeader: {
    padding: 26, marginBottom: 24,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 24, flexWrap: "wrap",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" },
  logoShield: {
    width: 68, height: 68, borderRadius: 16,
    border: "none",
    background: "linear-gradient(150deg, var(--accent-lt), var(--accent-dk))",
    display: "grid", placeItems: "center",
    fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-.01em",
    boxShadow: "0 2px 4px rgba(16,24,40,.12), 0 10px 22px -8px rgba(var(--accent-rgb),.6), inset 0 1px 0 rgba(255,255,255,.26)",
    flexShrink: 0,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  titleBig: {
    margin: 0, fontSize: 29, fontWeight: 690,
    color: "var(--ink)", letterSpacing: "-.034em", lineHeight: 1.15,
  },
  editBtn: {
    padding: "6px 12px", borderRadius: 8,
    border: "1px solid var(--border)",
    color: "var(--text)", background: "var(--surface)",
    boxShadow: "var(--shadow-xs)",
    fontSize: 13, fontWeight: 550, cursor: "pointer", fontFamily: "inherit",
  },
  metaRow: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
    marginTop: 12, color: "var(--text)", fontSize: 14,
  },
  metaItem: {
    display: "inline-flex", alignItems: "center",
    fontSize: 14, fontWeight: 500, color: "var(--text)",
    lineHeight: 1.4,
  },
  greenBadge: {
    display: "inline-flex", alignItems: "center",
    borderRadius: 99, padding: "4px 11px",
    background: "var(--accent-soft)", color: "var(--accent)",
    fontWeight: 600, fontSize: 12.5, letterSpacing: "-.005em",
    border: "1px solid rgba(var(--accent-rgb),.16)",
  },
  addTeamInline: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  logoPicker: {
    width: 46, height: 46,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--surface2)",
    border: "1px dashed var(--border2)",
    color: "var(--muted)",
    borderRadius: 8,
    cursor: "pointer", overflow: "hidden",
    transition: "border-color .15s",
  },
  logoPickerHint: {
    fontSize: 11, fontWeight: 500,
  },
  logoClearBtn: {
    width: 22, height: 22, borderRadius: 4,
    border: "1px solid var(--border)",
    background: "transparent", color: "var(--muted)",
    fontSize: 12, lineHeight: 1, padding: 0,
    cursor: "pointer", marginLeft: -4,
  },
  addTeamInput: {
    width: 190, padding: "9px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border2)",
    borderRadius: 8, color: "var(--text)", outline: "none",
    fontSize: 14, fontFamily: "inherit",
  },
  addTeamSmall: {
    width: 56, padding: "9px 12px", textAlign: "center",
    background: "var(--surface)",
    border: "1px solid var(--border2)",
    borderRadius: 8, color: "var(--text)", textTransform: "uppercase",
    fontSize: 14, fontFamily: "inherit",
  },
  primaryBtn: {
    padding: "9px 16px",
    background: "linear-gradient(180deg, var(--accent-lt), var(--accent))",
    border: 0, borderRadius: 9, color: "#fff",
    fontWeight: 560, fontSize: 14, cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "var(--shadow-accent), inset 0 1px 0 rgba(255,255,255,.22)",
  },
  // ── Prize panel ──
  prizeCardWrap: { padding: 26, marginBottom: 24 },
  prizeTop: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", flexWrap: "wrap", gap: 16,
  },
  sectionTitle: { margin: "5px 0 0", fontSize: 18, fontWeight: 640, color: "var(--ink)", letterSpacing: "-.024em" },
  poolValue: { fontSize: 28, fontWeight: 690, textAlign: "right", color: "var(--ink)", letterSpacing: "-.035em", fontVariantNumeric: "tabular-nums", marginTop: 2 },
  prizeGrid: {
    marginTop: 22,
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
    borderTop: "1px solid var(--border)",
  },
  prizeItem: {
    padding: "20px 20px",
    borderRight: "1px solid var(--border)",
  },
  prizeAmount: { fontSize: 21, fontWeight: 650, letterSpacing: "-.028em", fontVariantNumeric: "tabular-nums" },
  // ── Footer info ──
  footerInfo: {
    marginTop: 32, padding: 26,
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20,
  },
  infoItem: { display: "flex", gap: 14, alignItems: "center" },
  iconCircle: {
    width: 42, height: 42, borderRadius: 12,
    display: "grid", placeItems: "center",
    background: "linear-gradient(160deg, rgba(var(--accent-rgb),.12), rgba(var(--accent-rgb),.05))",
    boxShadow: "inset 0 0 0 1px rgba(var(--accent-rgb),.12)",
    color: "var(--accent)", fontSize: 24,
    flexShrink: 0,
  },
  statCell: {
    fontVariantNumeric: "tabular-nums",
    textAlign: "center", color: "var(--text)",
  },
  resultsToolbar: {
    display: "flex", alignItems: "flex-end", gap: 22, flexWrap: "wrap",
    padding: "16px 20px", marginBottom: 24,
    background: "var(--surface)", border: "none",
    borderRadius: 14, boxShadow: "var(--shadow)",
  },
  resultsFilterGroup: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  resultsFilterLabel: {
    fontSize: 12, fontWeight: 500, color: "var(--muted)",
  },
  qualLegend: {
    display: "flex", gap: 18, padding: "12px 16px",
    borderTop: "1px solid var(--border)", background: "var(--surface2)",
    flexWrap: "wrap",
  },
  legendItem: {
    display: "inline-flex", alignItems: "center", gap: 8,
    fontSize: 12, color: "var(--muted)",
  },
  legendDot: {
    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
  },
  infoStrip: {
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
    background: "var(--surface)", border: "none", borderRadius: 16,
    boxShadow: "var(--shadow-md)", overflow: "hidden",
    marginTop: 32,
  },
  infoBlock: {
    display: "flex", flexDirection: "column", gap: 6,
    padding: "18px 22px",
    borderRight: "1px solid var(--border)",
  },
  infoLabel: {
    fontSize: 12, fontWeight: 500, color: "var(--muted)",
  },
  infoValue: {
    fontSize: 15, fontWeight: 600, color: "var(--text)",
    letterSpacing: "-.2px",
  },
  championBanner: {
    display: "flex", alignItems: "flex-end", gap: 18, justifyContent: "space-between",
    background: "var(--surface)",
    borderLeft: "3px solid var(--gold)",
    padding: "18px 22px", marginBottom: 20,
    flexWrap: "wrap",
  },
  prizePanel: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    padding: "22px 24px", marginBottom: 28,
  },
  prizePanelHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    gap: 16, marginBottom: 22, flexWrap: "wrap",
    paddingBottom: 18, borderBottom: "1px solid var(--border)",
  },
  prizePanelEyebrow: {
    fontSize: 12, fontWeight: 500, color: "var(--muted)", margin: 0, marginBottom: 6,
  },
  prizePanelTotal: {
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
  },
  prizePlacesGrid: {
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
  },
  prizePlaceCard: {
    display: "flex", flexDirection: "column",
    padding: "14px 18px",
    borderTop: "2px solid var(--border)",
    borderRight: "1px solid var(--border)",
  },
  heroMeta: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 },
  metaText: { color: "var(--muted)", fontSize: 13 },
  addForm: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  matchFormRow: { display: "grid", gridTemplateColumns: "160px 1fr auto 1fr auto", gap: 16, alignItems: "start" },
  phaseHeader: {
    display: "flex", alignItems: "center", gap: 12,
    marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border)",
  },
  phaseDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  sectionLabel: { fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 12 },
  groupsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24, marginTop: 28 },
  groupCardWrap: { overflow: "hidden" },
  groupHead: {
    padding: "20px 22px",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    borderBottom: "1px solid var(--border)",
    background: "linear-gradient(180deg, var(--surface2), var(--surface))",
  },
  // legacy aliases (used by ungrouped block)
  groupCard: { background: "var(--surface)", border: "none", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-md)" },
  groupHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "2px solid", background: "var(--surface2)" },
  groupLetter: { fontWeight: 700, fontSize: 19, letterSpacing: "-.028em" },
  advancingRow: { background: "rgba(var(--accent-rgb),.045)" },
  advanceBanner: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
    padding: "16px 20px", marginBottom: 24,
    background: "rgba(var(--accent-rgb),.08)", border: "1px solid rgba(var(--accent-rgb),.3)",
    borderRadius: 12, flexWrap: "wrap",
  },
  groupMoveRow: { padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--surface2)" },
  ungroupedRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" },
  teamList: { background: "var(--surface)", border: "none", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-md)" },
  teamRow: { display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid var(--border)" },
  teamNum: { width: 26, height: 26, borderRadius: 8, background: "var(--surface2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 620, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  rosterPanel: {
    padding: "10px 16px 14px 52px",
    background: "rgba(var(--accent-rgb),.03)",
    borderBottom: "1px solid var(--border)",
  },
  rosterRow: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" },
  permissionsCard: {
    background: "var(--surface)", border: "none",
    borderRadius: 16, padding: 26, maxWidth: 640,
    boxShadow: "var(--shadow-md)",
  },
  collabRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "11px 15px", background: "var(--surface2)",
    border: "1px solid var(--border)", borderRadius: 10,
  },
};

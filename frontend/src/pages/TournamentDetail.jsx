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
                    <div style={s.winnerTrophy}>🏆</div>
                    <div>
                      <div style={{ ...s.label, color: "var(--gold-bright)" }}>Tournament Winner</div>
                      <div style={s.winnerTitle}>{champion}</div>
                    </div>
                  </div>
                  <div style={s.winnerRight}>
                    <div style={s.label}>Final Score</div>
                    <div style={s.scoreText}>
                      <span style={{ color: homeWon ? "var(--gold-bright)" : "rgba(255,255,255,.8)", fontWeight: homeWon ? 900 : 700 }}>
                        {teamName(finalMatch.home_team_id)}
                      </span>
                      <span style={{ color: "#fff", margin: "0 8px", fontVariantNumeric: "tabular-nums" }}>
                        {finalMatch.score_home} – {finalMatch.score_away}
                        {onPens && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)", marginLeft: 6 }}>
                            ({finalMatch.pen_home}–{finalMatch.pen_away} pens)
                          </span>
                        )}
                      </span>
                      <span style={{ color: !homeWon ? "var(--gold-bright)" : "rgba(255,255,255,.8)", fontWeight: !homeWon ? 900 : 700 }}>
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
                        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {finishedMatches}/{totalMatches} · {pct}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .3s ease" }} />
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
                    Groups pair up as A–B, C–D, E–F, G–H — use 2, 4 or 8 groups for a complete bracket.
                  </span>
                </form>
              )}
            </section>
          </>
        );
      })()}

      {(() => {
        const prizes = [
          { key: "prize_first",  rank: "01", place: "First Place",  emoji: "🏆", color: "var(--gold)" },
          { key: "prize_second", rank: "02", place: "Second Place", emoji: "🥈", color: "#64748b" },
          { key: "prize_third",  rank: "03", place: "Third Place",  emoji: "🥉", color: "#92400e" },
          { key: "prize_fourth", rank: "04", place: "Fourth Place", emoji: "",   color: "var(--muted)" },
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
                    <div style={{ ...s.label, color: p.color }}>{p.rank}</div>
                    <div style={{ ...s.label, marginTop: 8 }}>{p.place}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, minHeight: 40 }}>
                      <div style={{
                        ...s.prizeAmount,
                        color: isSet ? (p.rank === "01" ? p.color : "var(--text)") : "var(--muted)",
                      }}>
                        {isSet ? `€${value.toLocaleString()}` : "—"}
                      </div>
                      <div style={{ fontSize: 32, width: 36, textAlign: "right", lineHeight: 1 }}>
                        {p.emoji || ""}
                      </div>
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
                              width: 30, height: 30, borderRadius: "50%",
                              display: "inline-grid", placeItems: "center",
                              background: inAdvancingRank ? "rgba(var(--accent-rgb),.20)" : "var(--surface2)",
                              color: inAdvancingRank ? "var(--accent)" : "var(--muted)",
                              fontWeight: 900, fontSize: 12,
                            }}>{i + 1}</span>
                          </td>
                          <td style={{ fontWeight: 800 }}>
                            {t.name}
                            {inAdvancingRank && (
                              <span style={{ color: "var(--accent)", fontSize: 12, marginLeft: 6 }}> ↑ advances</span>
                            )}
                          </td>
                          <td style={s.statCell}>{rec.P}</td>
                          <td style={s.statCell}>{rec.W}</td>
                          <td style={s.statCell}>{rec.D}</td>
                          <td style={s.statCell}>{rec.L}</td>
                          <td style={s.statCell}>{st?.goals_scored ?? 0}</td>
                          <td style={s.statCell}>{st?.goals_conceded ?? 0}</td>
                          <td style={{ ...s.statCell, color: (st?.goal_diff ?? 0) > 0 ? "var(--accent)" : (st?.goal_diff ?? 0) < 0 ? "var(--red)" : "var(--muted)", fontWeight: 700 }}>
                            {(st?.goal_diff ?? 0) > 0 ? "+" : ""}{st?.goal_diff ?? 0}
                          </td>
                          <td style={{
                            ...s.statCell,
                            fontWeight: 900,
                            color: (st?.points ?? 0) >= 7 ? "var(--accent)" : (st?.points ?? 0) <= 4 ? "var(--orange)" : "var(--text)",
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

          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
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
          ["📅", "Date",            "TBA"],
          ["👥", "Format",          "8 Groups + Knockout"],
          ["⏱",  "Match Duration", "2 × 20 min"],
          ["📍", "Location",        tournament.location || "—"],
        ].map(([icon, label, value]) => (
          <div key={label} style={s.infoItem}>
            <div style={s.iconCircle}>{icon}</div>
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

/* ── Knockout Bracket ── */
function KnockoutBracket({ phases, phaseLabel, matches, teamName, isOrganizer, setResultForm, dateEdit, setDateEdit, saveMatchDate }) {
  const B = "2px solid var(--border2)";

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
                  <div style={{ width: 48, display: "flex", flexDirection: "column", paddingTop: 32 }}>
                    {showConnector
                      ? Array.from({ length: connectorPairs }).map((_, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                            <div style={{ flex: 1, borderBottom: B, borderRight: B, borderRadius: "0 0 8px 0" }} />
                            <div style={{ flex: 1, borderTop: B, borderRight: B, borderRadius: "0 8px 0 0" }} />
                          </div>
                        ))
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
      <div style={{ width: 210, flexShrink: 0 }}>
        <div style={{
          border: "1.5px dashed var(--border)", borderRadius: 8, width: 210,
          background: "var(--surface)", opacity: 0.5, flexShrink: 0,
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 13 }}>TBD</div>
          <div style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 13 }}>TBD</div>
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
    <div style={{ width: 210, flexShrink: 0 }}>
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
        border: `1.5px solid ${isFinal ? "var(--accent)" : isFinished ? "rgba(var(--accent-rgb),.35)" : "var(--border)"}`,
        borderRadius: 8, overflow: "hidden", background: "var(--surface)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 10px", borderBottom: "1px solid var(--border)",
          background: homeWon ? "rgba(var(--accent-rgb),.08)" : "transparent",
        }}>
          <span style={{ fontSize: 13, fontWeight: homeWon ? 700 : 500, color: homeWon ? "var(--accent)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
            {homeName}
          </span>
          {isFinished && (
            <span style={{ fontSize: 16, fontWeight: 700, color: homeWon ? "var(--accent)" : "var(--muted)", minWidth: 22, textAlign: "right", whiteSpace: "nowrap" }}>
              {match.score_home}
              {wentToPens && (
                <span style={{ fontSize: 11, fontWeight: 700, color: homeWon ? "var(--gold)" : "var(--muted)", marginLeft: 4 }}>
                  ({match.pen_home})
                </span>
              )}
            </span>
          )}
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 10px",
          background: awayWon ? "rgba(var(--accent-rgb),.08)" : "transparent",
        }}>
          <span style={{ fontSize: 13, fontWeight: awayWon ? 700 : 500, color: awayWon ? "var(--accent)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
            {awayName}
          </span>
          {isFinished && (
            <span style={{ fontSize: 16, fontWeight: 700, color: awayWon ? "var(--accent)" : "var(--muted)", minWidth: 22, textAlign: "right", whiteSpace: "nowrap" }}>
              {match.score_away}
              {wentToPens && (
                <span style={{ fontSize: 11, fontWeight: 700, color: awayWon ? "var(--gold)" : "var(--muted)", marginLeft: 4 }}>
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
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".7px", margin: 0, marginBottom: 8, textAlign: "center" }}>
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
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 12 }}>
            Prize Distribution
          </p>
          <div className="prize-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { key: "prize_first",  label: "🥇 1st" },
              { key: "prize_second", label: "🥈 2nd" },
              { key: "prize_third",  label: "🥉 3rd" },
              { key: "prize_fourth", label: "🎖️ 4th" },
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
    background: "rgba(16,24,40,.5)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 24,
    backdropFilter: "blur(2px)",
  },
  card: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 14, padding: 24, width: "100%", maxWidth: 420,
    boxShadow: "0 24px 60px rgba(16,24,40,.18)",
  },
  eyebrow: {
    fontSize: 11, fontWeight: 700, color: "var(--accent)",
    textTransform: "uppercase", letterSpacing: ".8px", margin: 0,
  },
  closeBtn: {
    background: "transparent", border: "1px solid var(--border)",
    color: "var(--muted)", borderRadius: 8, width: 30, height: 30,
    cursor: "pointer", fontSize: 14,
  },
  teamsRow: {
    display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 14,
    alignItems: "center", marginBottom: 18, padding: "12px 14px",
    background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
  },
  teamName: { fontSize: 15, fontWeight: 600, color: "var(--text)" },
  scoreRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 14 },
  scoreInput: {
    width: 70, height: 56,
    textAlign: "center", fontSize: 24, fontWeight: 700,
  },
};

/* ── Section group (Upcoming / Awaiting date / Finished) ── */
function MatchesGroup({ title, accent, subtitle, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: accent }}>{title}</h2>
        {subtitle && <span style={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</span>}
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 10, borderBottom: `2px solid ${borderColor}` }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: ".5px" }}>
          {dateSectionLabel(date)}
        </h3>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
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
          background: "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 6, flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size,
      display: "grid", placeItems: "center",
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderRadius: 6, color: "var(--muted)",
      fontSize: 13, fontWeight: 800, flexShrink: 0,
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
        fontSize: 15, fontWeight: won ? 800 : 600,
        color: won ? accent : "var(--text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {pen != null && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: wonOnPens ? "var(--gold)" : "var(--muted)",
          }}>({pen})</span>
        )}
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 27, fontWeight: 700,
          color: won ? accent : "var(--text)",
          minWidth: 24, textAlign: "right",
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
        <span style={rcs.dateText}>{dateStr.toUpperCase()}</span>
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
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "16px 22px",
  },
  dateBlock: { display: "flex", flexDirection: "column", gap: 4 },
  dateText: {
    fontSize: 12, fontWeight: 800, color: "var(--text)",
    letterSpacing: 1.6,
  },
  timeText: {
    fontSize: 18, fontWeight: 700, color: "var(--ink)",
    letterSpacing: 0.5, fontVariantNumeric: "tabular-nums",
  },
  stageHint: {
    fontSize: 11, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: 1.4,
  },
  divider: { width: 1, alignSelf: "stretch", background: "var(--border)" },
  teamsCol: { display: "flex", flexDirection: "column" },
  rightCol: {
    display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
    paddingLeft: 14, borderLeft: "1px solid var(--border)",
    width: 150,
  },
  stagePill: {
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: 1.2,
    textAlign: "center",
  },
  fullTime: {
    fontSize: 11, fontWeight: 700, color: "var(--accent)",
    background: "rgba(var(--accent-rgb),.10)",
    border: "1px solid rgba(var(--accent-rgb),.35)",
    padding: "3px 10px", borderRadius: 4,
    textTransform: "uppercase", letterSpacing: 1.2,
    textAlign: "center",
  },
  afterPens: {
    fontSize: 11, fontWeight: 700, color: "var(--gold)",
    background: "rgba(180,83,9,.08)",
    border: "1px solid rgba(180,83,9,.3)",
    padding: "3px 10px", borderRadius: 4,
    textTransform: "uppercase", letterSpacing: 1.2,
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
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: ".8px",
    height: 32, display: "flex", alignItems: "center",
    padding: "0 8px", margin: 0,
  },
  scoreInput: {
    width: 44, padding: "4px 6px", textAlign: "center", fontSize: 14, fontWeight: 700,
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text)", outline: "none",
  },
};

const mc = {
  card: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, padding: "14px 18px",
    borderLeft: "3px solid transparent",
  },
  finished: { borderColor: "rgba(var(--accent-rgb),.25)" },
  row: { display: "flex", alignItems: "center", gap: 16 },
  stageBadge: {
    fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
    textTransform: "uppercase", letterSpacing: ".5px",
  },
  team: { flex: 1, fontWeight: 600, fontSize: 15 },
  winner: { color: "var(--accent)" },
  scoreBox: { display: "flex", alignItems: "center", gap: 8 },
  score: { fontSize: 26, fontWeight: 700, color: "var(--muted)", minWidth: 28, textAlign: "center" },
  winScore: { color: "var(--accent)" },
  sep: { fontSize: 22, fontWeight: 300, color: "var(--border)" },
  vsLabel: { fontSize: 13, fontWeight: 600, color: "var(--muted)", padding: "4px 12px", background: "var(--surface2)", borderRadius: 20 },
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
    border: "1px solid var(--border)",
    borderRadius: 14,
    boxShadow: "var(--shadow)",
  },
  label: {
    fontSize: 12, letterSpacing: 3, textTransform: "uppercase",
    color: "var(--muted)", fontWeight: 800,
  },
  // ── Winner banner ──
  winner: {
    minHeight: 150, marginBottom: 24,
    borderRadius: 12,
    border: "1px solid var(--border)",
    overflow: "hidden",
    background: "linear-gradient(90deg, rgba(250,204,21,0.16), rgba(17,29,46,0.92) 42%, rgba(7,17,31,0.92)), url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&q=70') center/cover",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 34px",
    boxShadow: "0 22px 55px rgba(16,24,40,.18)",
    position: "relative", flexWrap: "wrap", gap: 18,
  },
  winnerAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: "var(--gold-bright)" },
  winnerLeft: {
    display: "flex", alignItems: "center", gap: 26,
    flex: "1 1 280px", minWidth: 260,
  },
  winnerRight: {
    textAlign: "right",
    flex: "0 1 auto", minWidth: 200,
  },
  winnerTrophy: {
    fontSize: 52, lineHeight: 1, flexShrink: 0,
  },
  winnerTitle: {
    fontFamily: "var(--font-display)", textTransform: "uppercase",
    marginTop: 10, fontSize: 42, fontWeight: 700,
    lineHeight: .95, color: "#fff", letterSpacing: ".5px",
  },
  scoreText: { fontSize: 18, fontWeight: 800, marginTop: 8, color: "#fff" },
  // ── Tournament header ──
  tournamentHeader: {
    padding: 30, marginBottom: 24,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 24, flexWrap: "wrap",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" },
  logoShield: {
    width: 92, height: 92, borderRadius: 18,
    border: "1px solid rgba(var(--accent-rgb),.35)",
    background: "linear-gradient(145deg, #ffffff, #eef2ee)",
    display: "grid", placeItems: "center",
    fontFamily: "var(--font-display)",
    fontSize: 30, fontWeight: 700, color: "var(--accent)", letterSpacing: 1.5,
    boxShadow: "inset 0 0 0 1px rgba(16,24,40,.03), 0 4px 16px rgba(var(--accent-rgb),.10)",
    flexShrink: 0,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  titleBig: {
    fontFamily: "var(--font-display)", textTransform: "uppercase",
    margin: 0, fontSize: 44, fontWeight: 700,
    color: "var(--ink)", letterSpacing: ".5px", lineHeight: .95,
  },
  editBtn: {
    padding: "7px 12px", borderRadius: 7,
    border: "1px solid var(--border)",
    color: "var(--muted)", background: "rgba(16,24,40,.04)",
    fontSize: 13, cursor: "pointer",
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
    borderRadius: 999, padding: "5px 11px",
    background: "rgba(var(--accent-rgb),.14)", color: "var(--accent)",
    fontWeight: 800, fontSize: 13,
    border: "1px solid rgba(var(--accent-rgb),.45)",
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
    fontSize: 10, fontWeight: 700, letterSpacing: "1px",
    textTransform: "uppercase",
  },
  logoClearBtn: {
    width: 22, height: 22, borderRadius: 4,
    border: "1px solid var(--border)",
    background: "transparent", color: "var(--muted)",
    fontSize: 12, lineHeight: 1, padding: 0,
    cursor: "pointer", marginLeft: -4,
  },
  addTeamInput: {
    width: 190, padding: "13px 14px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8, color: "var(--text)", outline: "none",
    fontSize: 14,
  },
  addTeamSmall: {
    width: 64, padding: "13px 14px", textAlign: "center",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8, color: "var(--text)", textTransform: "uppercase",
    fontSize: 14,
  },
  primaryBtn: {
    padding: "13px 18px",
    background: "linear-gradient(135deg, var(--accent), #16a34a)",
    border: 0, borderRadius: 8, color: "#fff",
    fontWeight: 800, fontSize: 14, cursor: "pointer",
    boxShadow: "0 12px 24px rgba(var(--accent-rgb),.24)",
  },
  // ── Prize panel ──
  prizeCardWrap: { padding: 28, marginBottom: 28 },
  prizeTop: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-start", flexWrap: "wrap", gap: 16,
  },
  sectionTitle: { margin: "8px 0 0", fontSize: 22, fontWeight: 900, color: "var(--ink)" },
  poolValue: { fontSize: 36, fontWeight: 900, textAlign: "right", color: "var(--ink)", letterSpacing: "-.6px", fontVariantNumeric: "tabular-nums" },
  prizeGrid: {
    marginTop: 28,
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
    borderTop: "3px solid var(--ink)",
  },
  prizeItem: {
    padding: "24px 22px",
    borderRight: "1px solid var(--border)",
    background: "rgba(16,24,40,.03)",
  },
  prizeAmount: { fontSize: 26, fontWeight: 900, letterSpacing: "-.4px", fontVariantNumeric: "tabular-nums" },
  // ── Footer info ──
  footerInfo: {
    marginTop: 32, padding: 28,
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 22,
  },
  infoItem: { display: "flex", gap: 14, alignItems: "center" },
  iconCircle: {
    width: 54, height: 54, borderRadius: "50%",
    display: "grid", placeItems: "center",
    background: "rgba(var(--accent-rgb),.14)",
    color: "var(--accent)", fontSize: 24,
    flexShrink: 0,
  },
  statCell: {
    fontVariantNumeric: "tabular-nums",
    textAlign: "center", color: "var(--text)",
  },
  resultsToolbar: {
    display: "flex", alignItems: "flex-end", gap: 22, flexWrap: "wrap",
    padding: "14px 18px", marginBottom: 22,
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 10,
  },
  resultsFilterGroup: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  resultsFilterLabel: {
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: ".7px",
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
    background: "var(--surface)", border: "1px solid var(--border)",
    marginTop: 32,
  },
  infoBlock: {
    display: "flex", flexDirection: "column", gap: 6,
    padding: "18px 22px",
    borderRight: "1px solid var(--border)",
  },
  infoLabel: {
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: "1.4px",
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
    fontSize: 11, fontWeight: 600, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: "1.6px", margin: 0, marginBottom: 6,
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
  sectionLabel: { fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 12 },
  groupsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 22, marginTop: 26 },
  groupCardWrap: { overflow: "hidden" },
  groupHead: {
    padding: "20px 22px",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    borderBottom: "1px solid var(--border)",
    background: "rgba(16,24,40,.04)",
  },
  // legacy aliases (used by ungrouped block)
  groupCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" },
  groupHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "2px solid", background: "var(--surface2)" },
  groupLetter: { fontWeight: 900, fontSize: 20 },
  advancingRow: { background: "rgba(var(--accent-rgb),.05)" },
  advanceBanner: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
    padding: "16px 20px", marginBottom: 24,
    background: "rgba(var(--accent-rgb),.08)", border: "1px solid rgba(var(--accent-rgb),.3)",
    borderRadius: 12, flexWrap: "wrap",
  },
  groupMoveRow: { padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--surface2)" },
  ungroupedRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" },
  teamList: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" },
  teamRow: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" },
  teamNum: { width: 24, height: 24, borderRadius: "50%", background: "var(--surface2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 },
  rosterPanel: {
    padding: "10px 16px 14px 52px",
    background: "rgba(var(--accent-rgb),.03)",
    borderBottom: "1px solid var(--border)",
  },
  rosterRow: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" },
  permissionsCard: {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, padding: 24, maxWidth: 640,
  },
  collabRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px", background: "var(--surface2)",
    border: "1px solid var(--border)", borderRadius: 8,
  },
};

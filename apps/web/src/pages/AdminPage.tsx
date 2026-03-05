import { useState, useEffect, type FormEvent } from "react";
import { api, type AdminUser, type SyncJob } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type Tab = "users" | "sync" | "config";

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  if (currentUser?.role !== "super_admin") {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--danger)", padding: "2rem" }}>
        Acces reserve aux super-administrateurs.
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: "1rem" }}>Administration</h2>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          className={tab === "users" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setTab("users")}
        >
          Utilisateurs
        </button>
        <button
          className={tab === "sync" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setTab("sync")}
        >
          Statut des syncs
        </button>
        <button
          className={tab === "config" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setTab("config")}
        >
          Configuration
        </button>
      </div>

      {tab === "users" && <UsersTab currentUserId={currentUser.id} />}
      {tab === "sync" && <SyncTab />}
      {tab === "config" && <ConfigTab />}
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("viewer");
  const [creating, setCreating] = useState(false);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editName, setEditName] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await api.adminUsers();
      setUsers(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.adminCreateUser({
        email: formEmail,
        password: formPassword,
        name: formName,
        role: formRole,
      });
      setUsers((prev) => [...prev, res.data]);
      setFormName("");
      setFormEmail("");
      setFormPassword("");
      setFormRole("viewer");
      setShowCreate(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    if (user.id === currentUserId) return;
    try {
      const res = await api.adminUpdateUser(user.id, { isActive: !user.isActive });
      setUsers((prev) => prev.map((u) => (u.id === res.data.id ? { ...u, ...res.data } : u)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function handleSaveEdit(userId: string) {
    try {
      const res = await api.adminUpdateUser(userId, { name: editName, role: editRole });
      setUsers((prev) => prev.map((u) => (u.id === res.data.id ? { ...u, ...res.data } : u)));
      setEditId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function handleDelete(user: AdminUser) {
    if (user.id === currentUserId) return;
    if (!confirm(`Supprimer l'utilisateur "${user.name}" (${user.email}) ? Cette action est irreversible.`)) return;
    try {
      await api.adminDeleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  function startEdit(user: AdminUser) {
    setEditId(user.id);
    setEditName(user.name);
    setEditRole(user.role);
  }

  function formatDate(date: string): string {
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          {users.length} utilisateur{users.length > 1 ? "s" : ""}
        </span>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Annuler" : "+ Inviter un utilisateur"}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Nom</label>
                <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Email</label>
                <input className="form-input" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Mot de passe</label>
                <input className="form-input" type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} required minLength={8} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Role</label>
                <select className="filter-select" value={formRole} onChange={(e) => setFormRole(e.target.value)} style={{ width: "100%", padding: "0.625rem 0.75rem" }}>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: "1rem" }}>
              <button className="btn btn-primary" type="submit" disabled={creating}>
                {creating ? "Creation..." : "Creer le compte"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Role</th>
              <th>Statut</th>
              <th>Presets</th>
              <th>Digests</th>
              <th>Inscrit le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {editId === user.id ? (
                    <input
                      className="form-input"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem", width: 120 }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  ) : (
                    <>
                      {user.name}
                      {user.id === currentUserId && (
                        <span style={{ marginLeft: "0.25rem", fontSize: "0.7rem", color: "var(--primary)" }}>(toi)</span>
                      )}
                    </>
                  )}
                </td>
                <td>{user.email}</td>
                <td>
                  {editId === user.id ? (
                    <select
                      className="filter-select"
                      style={{ fontSize: "0.8125rem", minWidth: 100 }}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                      <option value="super_admin">super_admin</option>
                    </select>
                  ) : (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                        background: user.role === "super_admin" ? "var(--primary)" : user.role === "admin" ? "var(--warning)" : "var(--bg-input)",
                        color: user.role === "viewer" ? "var(--text-muted)" : "white",
                      }}
                    >
                      {user.role}
                    </span>
                  )}
                </td>
                <td>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                      background: user.isActive ? "var(--success)" : "var(--danger)",
                      color: "white",
                    }}
                  >
                    {user.isActive ? "Actif" : "Inactif"}
                  </span>
                </td>
                <td className="text-right">{user._count.presets}</td>
                <td className="text-right">{user._count.emailDigests}</td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    {editId === user.id ? (
                      <>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                          onClick={() => handleSaveEdit(user.id)}
                        >
                          OK
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                          onClick={() => setEditId(null)}
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                          onClick={() => startEdit(user)}
                        >
                          Editer
                        </button>
                        {user.id !== currentUserId && (
                          <>
                            <button
                              className="btn btn-ghost"
                              style={{
                                fontSize: "0.75rem",
                                padding: "0.25rem 0.5rem",
                                color: user.isActive ? "var(--warning)" : "var(--success)",
                              }}
                              onClick={() => handleToggleActive(user)}
                            >
                              {user.isActive ? "Bloquer" : "Debloquer"}
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "var(--danger)" }}
                              onClick={() => handleDelete(user)}
                            >
                              Suppr.
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sync Tab ─────────────────────────────────────────────

const SYNC_JOB_LABELS: Record<string, string> = {
  "sync-eod": "Prix EOD",
  "sync-tickers": "Tickers",
  "sync-fundamentals": "Fondamentaux",
  "backfill-eod": "Backfill prix historiques",
};

const TRIGGERABLE_JOBS = ["sync-eod", "sync-tickers", "sync-fundamentals", "backfill-eod"];

function SyncTab() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [pendingSync, setPendingSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadJobs();
  }, []);

  // Auto-refresh while a sync is running or pending
  useEffect(() => {
    const hasRunningOrPending = !!pendingSync || jobs.some((j) => j.status === "running" || j.status === "pending");
    if (!hasRunningOrPending) return;
    const interval = setInterval(loadJobs, 5_000);
    return () => clearInterval(interval);
  }, [jobs, pendingSync]);

  async function loadJobs() {
    try {
      const res = await api.adminSyncStatus();
      setJobs(res.data);
      setPendingSync(res.pendingSync);
      if (!loading) return; // don't clear loading on refreshes
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function handleTrigger(jobName: string) {
    const label = SYNC_JOB_LABELS[jobName] ?? jobName;
    if (!confirm(`Lancer la synchronisation "${label}" ? Le worker l'executera sous 15 secondes.`)) return;
    setTriggering(jobName);
    setMessage(null);
    try {
      const res = await api.adminTriggerSync(jobName);
      setMessage({ text: res.data.message, type: "success" });
      setPendingSync(jobName);
      // Refresh after a short delay
      setTimeout(loadJobs, 2_000);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Erreur", type: "error" });
    } finally {
      setTriggering(null);
    }
  }

  async function handleAbort() {
    if (!confirm("Arreter la synchronisation en cours ? Le job s'arretera proprement sous quelques secondes.")) return;
    setMessage(null);
    try {
      const res = await api.adminAbortSync();
      setMessage({ text: res.data.message, type: "success" });
      setPendingSync(null);
      setTimeout(loadJobs, 2_000);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Erreur", type: "error" });
    }
  }

  async function handleForceReset(jobName: string) {
    const label = SYNC_JOB_LABELS[jobName] ?? jobName;
    if (!confirm(`Forcer le reset du job "${label}" ? Son statut passera en erreur et vous pourrez relancer une sync.`)) return;
    setMessage(null);
    try {
      const res = await api.adminResetSync(jobName);
      setMessage({ text: res.data.message, type: "success" });
      setTimeout(loadJobs, 1_000);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Erreur", type: "error" });
    }
  }

  function formatDate(date: string | null): string {
    if (!date) return "Jamais";
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function statusColor(status: string): string {
    switch (status) {
      case "success":
        return "var(--success)";
      case "running":
        return "var(--warning)";
      case "error":
        return "var(--danger)";
      default:
        return "var(--text-muted)";
    }
  }

  const isAnySyncBusy = !!pendingSync || !!triggering || jobs.some((j) => j.status === "running");

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  return (
    <div>
      {/* Manual trigger section */}
      <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.25rem" }}>Lancer une synchronisation</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Declencher manuellement un job de sync. Le worker l'executera sous 15 secondes.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {TRIGGERABLE_JOBS.map((jobName) => {
            const isPending = pendingSync === jobName;
            const isRunning = jobs.find((j) => j.jobName === jobName)?.status === "running";
            const isThisTriggering = triggering === jobName;

            let label = SYNC_JOB_LABELS[jobName] ?? jobName;
            if (isThisTriggering) label = "Envoi...";
            else if (isPending) label = `${SYNC_JOB_LABELS[jobName]} (en attente)`;
            else if (isRunning) label = `${SYNC_JOB_LABELS[jobName]} (en cours)`;

            return (
              <button
                key={jobName}
                className="btn btn-ghost"
                style={{
                  borderColor: isPending || isRunning ? "var(--warning)" : undefined,
                  color: isPending || isRunning ? "var(--warning)" : undefined,
                }}
                disabled={isAnySyncBusy}
                onClick={() => handleTrigger(jobName)}
              >
                {label}
              </button>
            );
          })}
          {isAnySyncBusy && (
            <button
              className="btn btn-ghost"
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              onClick={handleAbort}
            >
              Arreter
            </button>
          )}
        </div>
        {message && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: message.type === "success" ? "var(--success)" : "var(--danger)" }}>
            {message.text}
          </div>
        )}
      </div>

      {/* Jobs status table */}
      {jobs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
          Aucun job de synchronisation execute. Le worker doit etre lance pour que les syncs se declenchent.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Statut</th>
                <th>Derniere execution</th>
                <th>Details</th>
                <th>Mis a jour</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const isStale = job.status === "error" && job.details?.includes("bloque depuis");
                const isRunning = job.status === "running";
                return (
                  <tr key={job.jobName}>
                    <td><strong>{job.jobName}</strong></td>
                    <td>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "0.25rem",
                          background: statusColor(job.status),
                          color: "white",
                        }}
                      >
                        {isStale ? "bloque" : job.status}
                      </span>
                    </td>
                    <td>{formatDate(job.lastRunAt)}</td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.details ?? undefined}>
                      {job.details ?? "—"}
                    </td>
                    <td>{formatDate(job.updatedAt)}</td>
                    <td>
                      {(isStale || isRunning) && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "var(--danger)" }}
                          onClick={() => handleForceReset(job.jobName)}
                        >
                          Forcer le reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Config Tab ──────────────────────────────────────────

const SYNC_MODE_INFO = {
  daily: {
    plan: "All World ($19.99/mois)",
    label: "Quotidien",
    desc: "EOD prices + tickers uniquement. Les fondamentaux ne sont pas synchronises.",
    color: "var(--warning)",
  },
  full: {
    plan: "All-in-One ($99.99/mois)",
    label: "Complet",
    desc: "Tous les syncs actifs, y compris les fondamentaux hebdomadaires.",
    color: "var(--success)",
  },
} as const;

function ConfigTab() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await api.adminGetConfig();
      setConfig(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function handleModeChange(newMode: string) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.adminUpdateConfig("SYNC_MODE", newMode);
      setConfig((prev) => ({ ...prev, SYNC_MODE: newMode }));
      setSuccess(
        newMode === "full"
          ? "Mode complet active. Les fondamentaux seront synchronises au prochain cron (samedi 6h)."
          : "Mode quotidien active. Les fondamentaux ne seront plus synchronises.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Chargement...</div>;
  if (error && !config.SYNC_MODE) return <div className="auth-error">{error}</div>;

  const currentMode = (config.SYNC_MODE ?? "daily") as keyof typeof SYNC_MODE_INFO;
  const modeInfo = SYNC_MODE_INFO[currentMode];

  return (
    <div>
      {/* Sync Mode Card */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.25rem" }}>Mode de synchronisation EODHD</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
          Controle quel plan EODHD est utilise. Le token API ne change pas entre les plans.
        </p>

        {/* Current mode display */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "1rem",
            borderRadius: "0.5rem",
            background: "var(--bg-input)",
            marginBottom: "1.25rem",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: modeInfo.color,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontWeight: 600 }}>
              {modeInfo.label} — {modeInfo.plan}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              {modeInfo.desc}
            </div>
          </div>
        </div>

        {/* Toggle buttons */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={currentMode === "daily" ? "btn btn-primary" : "btn btn-ghost"}
            disabled={saving || currentMode === "daily"}
            onClick={() => handleModeChange("daily")}
          >
            {saving && currentMode !== "daily" ? "..." : "Quotidien (All World)"}
          </button>
          <button
            className={currentMode === "full" ? "btn btn-primary" : "btn btn-ghost"}
            disabled={saving || currentMode === "full"}
            onClick={() => handleModeChange("full")}
          >
            {saving && currentMode !== "full" ? "..." : "Complet (All-in-One)"}
          </button>
        </div>

        {success && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--success)" }}>
            {success}
          </div>
        )}
        {error && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Plan comparison info */}
      <div className="card" style={{ padding: "1.25rem" }}>
        <h4 style={{ marginBottom: "0.75rem" }}>Strategie de cout EODHD</h4>
        <table className="data-table" style={{ fontSize: "0.8125rem" }}>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Job</th>
              <th>Quotidien</th>
              <th>Complet</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/eod-bulk-last-day</code></td>
              <td>sync-eod</td>
              <td style={{ color: "var(--success)" }}>actif</td>
              <td style={{ color: "var(--success)" }}>actif</td>
            </tr>
            <tr>
              <td><code>/exchange-symbol-list</code></td>
              <td>sync-tickers</td>
              <td style={{ color: "var(--success)" }}>actif</td>
              <td style={{ color: "var(--success)" }}>actif</td>
            </tr>
            <tr>
              <td><code>/fundamentals</code></td>
              <td>sync-fundamentals</td>
              <td style={{ color: "var(--danger)" }}>desactive</td>
              <td style={{ color: "var(--success)" }}>actif</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          Cout annuel optimise : 8 mois All World ($19.99) + 4 mois All-in-One ($99.99) = ~$560/an
          au lieu de $1000/an en All-in-One permanent.
        </p>
      </div>
    </div>
  );
}

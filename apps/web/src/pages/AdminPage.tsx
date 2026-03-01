import { useState, useEffect, type FormEvent } from "react";
import { api, type AdminUser, type SyncJob } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type Tab = "users" | "sync";

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
      </div>

      {tab === "users" && <UsersTab currentUserId={currentUser.id} />}
      {tab === "sync" && <SyncTab />}
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

function SyncTab() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await api.adminSyncStatus();
      setJobs(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
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

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  if (jobs.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
        Aucun job de synchronisation execute. Le worker doit etre lance pour que les syncs se declenchent.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Statut</th>
            <th>Derniere execution</th>
            <th>Details</th>
            <th>Mis a jour</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
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
                  {job.status}
                </span>
              </td>
              <td>{formatDate(job.lastRunAt)}</td>
              <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {job.details ?? "—"}
              </td>
              <td>{formatDate(job.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

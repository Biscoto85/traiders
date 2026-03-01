import { useState, useEffect } from "react";
import { api, type EmailDigest, type FilterOptions } from "@/lib/api";
import { DEFAULT_PRESETS } from "@stock-screener/shared";

export default function EmailDigestsPage() {
  const [digests, setDigests] = useState<EmailDigest[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSchedule, setNewSchedule] = useState<"weekly" | "daily">("weekly");
  const [newTemplate, setNewTemplate] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([api.emailDigests(), api.filterOptions()])
      .then(([digestRes, filterRes]) => {
        setDigests(digestRes.data);
        setFilterOptions(filterRes.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur de chargement"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const template = DEFAULT_PRESETS.find((p) => p.name === newTemplate);
      const filters = template ? (template.filters as Record<string, unknown>) : {};

      const res = await api.createEmailDigest({
        name: newName.trim(),
        filters,
        schedule: newSchedule,
      });
      setDigests((prev) => [res.data, ...prev]);
      setNewName("");
      setNewTemplate("");
      setShowCreate(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(digest: EmailDigest) {
    try {
      const res = await api.updateEmailDigest(digest.id, { isActive: !digest.isActive });
      setDigests((prev) =>
        prev.map((d) => (d.id === res.data.id ? res.data : d)),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer l'alerte "${name}" ?`)) return;
    try {
      await api.deleteEmailDigest(id);
      setDigests((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  function formatFilters(filters: Record<string, unknown>): string {
    const keys = Object.keys(filters);
    if (keys.length === 0) return "Aucun filtre (toutes les actions)";
    return keys
      .map((k) => {
        const v = filters[k] as { min?: number; max?: number } | string[] | undefined;
        if (Array.isArray(v)) return `${k}: ${v.join(", ")}`;
        if (v && typeof v === "object") {
          const parts: string[] = [];
          if (v.min !== undefined) parts.push(`>=${formatNum(v.min)}`);
          if (v.max !== undefined) parts.push(`<=${formatNum(v.max)}`);
          return `${k}: ${parts.join(" ")}`;
        }
        return k;
      })
      .join(" · ");
  }

  function formatNum(n: number): string {
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
    if (Math.abs(n) < 1 && n !== 0) return `${(n * 100).toFixed(0)}%`;
    return n.toLocaleString();
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

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2>Alertes email</h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Recois un email avec les actions qui correspondent a tes criteres.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Annuler" : "+ Nouvelle alerte"}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Nom de l'alerte</label>
              <input
                className="form-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Mes actions value preferees"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Frequence</label>
                <select
                  className="filter-select"
                  value={newSchedule}
                  onChange={(e) => setNewSchedule(e.target.value as "weekly" | "daily")}
                >
                  <option value="weekly">Hebdomadaire</option>
                  <option value="daily">Quotidien</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label>Filtres de base (strategie)</label>
                <select
                  className="filter-select"
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">Aucun filtre (toutes les actions)</option>
                  {DEFAULT_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? "Creation..." : "Creer l'alerte"}
              </button>
            </div>
          </div>
        </div>
      )}

      {digests.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {digests.map((digest) => (
            <div key={digest.id} className="card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <strong>{digest.name}</strong>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                        background: digest.isActive ? "var(--success)" : "var(--bg-input)",
                        color: digest.isActive ? "white" : "var(--text-muted)",
                      }}
                    >
                      {digest.isActive ? "Actif" : "Inactif"}
                    </span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                        background: "var(--bg-input)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {digest.schedule === "weekly" ? "Hebdo" : "Quotidien"}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatFilters(digest.filters)}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Dernier envoi : {formatDate(digest.lastSentAt)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <button
                    className="btn btn-ghost"
                    style={{
                      fontSize: "0.8125rem",
                      padding: "0.375rem 0.75rem",
                      color: digest.isActive ? "var(--warning)" : "var(--success)",
                    }}
                    onClick={() => handleToggleActive(digest)}
                  >
                    {digest.isActive ? "Desactiver" : "Activer"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem", color: "var(--danger)" }}
                    onClick={() => handleDelete(digest.id, digest.name)}
                  >
                    Suppr.
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
          Aucune alerte email configuree. Cree-en une pour recevoir des rapports reguliers.
        </div>
      )}
    </div>
  );
}

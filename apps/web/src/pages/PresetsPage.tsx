import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Preset } from "@/lib/api";
import { DEFAULT_PRESETS } from "@stock-screener/shared";

export default function PresetsPage() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Hidden default presets (stored in localStorage)
  const [hiddenDefaults, setHiddenDefaults] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hiddenDefaultPresets") || "[]");
    } catch {
      return [];
    }
  });

  function hideDefaultPreset(name: string) {
    if (!confirm(`Masquer la strategie "${name}" ?`)) return;
    const updated = [...hiddenDefaults, name];
    setHiddenDefaults(updated);
    localStorage.setItem("hiddenDefaultPresets", JSON.stringify(updated));
  }

  useEffect(() => {
    loadPresets();
  }, []);

  async function loadPresets() {
    setLoading(true);
    try {
      const res = await api.presets();
      setPresets(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer le preset "${name}" ?`)) return;
    try {
      await api.deletePreset(id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function handleTogglePublic(preset: Preset) {
    try {
      const res = await api.updatePreset(preset.id, { isPublic: !preset.isPublic });
      setPresets((prev) => prev.map((p) => (p.id === res.data.id ? { ...p, isPublic: res.data.isPublic } : p)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  function handleApply(filters: Record<string, unknown>, sort?: Record<string, unknown> | null) {
    const state: Record<string, unknown> = { filters };
    if (sort) state.sort = sort;
    navigate("/", { state });
  }

  async function handleCreateFromDefault(preset: (typeof DEFAULT_PRESETS)[number]) {
    try {
      const res = await api.createPreset({
        name: preset.name,
        filters: preset.filters as Record<string, unknown>,
        sort: preset.sort as Record<string, unknown>,
        isPublic: false,
      });
      setPresets((prev) => [res.data, ...prev]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function handleCreateEmpty() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createPreset({
        name: newName.trim(),
        filters: {},
        isPublic: false,
      });
      setPresets((prev) => [res.data, ...prev]);
      setNewName("");
      setShowCreate(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  function formatFilters(filters: Record<string, unknown>): string {
    const keys = Object.keys(filters);
    if (keys.length === 0) return "Aucun filtre";
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

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2>Mes presets de screening</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Annuler" : "+ Nouveau preset"}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Nom du preset</label>
              <input
                className="form-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Mon screening personnalise"
                onKeyDown={(e) => e.key === "Enter" && handleCreateEmpty()}
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreateEmpty} disabled={creating || !newName.trim()}>
              Creer
            </button>
          </div>
        </div>
      )}

      {/* User presets */}
      {presets.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
          {presets.map((preset) => (
            <div key={preset.id} className="card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <strong>{preset.name}</strong>
                    {preset.isPublic && (
                      <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.375rem", borderRadius: "0.25rem", background: "var(--primary)", color: "white" }}>
                        Public
                      </span>
                    )}
                    {preset.user && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        par {preset.user.name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatFilters(preset.filters)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
                    onClick={() => handleApply(preset.filters, preset.sort)}
                  >
                    Appliquer
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
                    onClick={() => handleTogglePublic(preset)}
                    title={preset.isPublic ? "Rendre prive" : "Rendre public"}
                  >
                    {preset.isPublic ? "Prive" : "Public"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem", color: "var(--danger)" }}
                    onClick={() => handleDelete(preset.id, preset.name)}
                  >
                    Suppr.
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: "2rem" }}>
          Aucun preset sauvegarde. Cree-en un ou utilise les strategies ci-dessous.
        </div>
      )}

      {/* Default presets */}
      <h3 style={{ marginBottom: "1rem", color: "var(--text-muted)", fontSize: "1rem" }}>
        Strategies expertes (modeles)
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {DEFAULT_PRESETS.filter((dp) => !hiddenDefaults.includes(dp.name)).map((dp) => (
          <div key={dp.name} className="card" style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{dp.name}</strong>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {dp.description}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {formatFilters(dp.filters as Record<string, unknown>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
                  onClick={() => handleApply(dp.filters as Record<string, unknown>, dp.sort as Record<string, unknown>)}
                >
                  Appliquer
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem" }}
                  onClick={() => handleCreateFromDefault(dp)}
                >
                  Sauvegarder
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem", color: "var(--danger)" }}
                  onClick={() => hideDefaultPreset(dp.name)}
                >
                  Suppr.
                </button>
              </div>
            </div>
          </div>
        ))}
        {hiddenDefaults.length > 0 && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: "0.75rem", alignSelf: "flex-start" }}
            onClick={() => { setHiddenDefaults([]); localStorage.removeItem("hiddenDefaultPresets"); }}
          >
            Restaurer les strategies masquees ({hiddenDefaults.length})
          </button>
        )}
      </div>
    </div>
  );
}

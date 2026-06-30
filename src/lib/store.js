// Etat partage entre toutes les pages du dashboard, persiste dans le navigateur.
// Chaque page (ile Svelte) charge l'etat au montage et le re-sauvegarde a chaque
// changement, ce qui garde les pages synchronisees via localStorage.
import { getPreset } from './presets.js';

export const STORE_KEY = 'finance-predict-v2';
export const CURRENT_YEAR = 2026;

let uid = 1;

export function makePlacement(presetId, monthly, initial) {
  const p = getPreset(presetId);
  return {
    uid: uid++,
    presetId,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    meanReturn: p.meanReturn,
    volatility: p.volatility,
    ter: p.ter,
    monthly,
    initial,
  };
}

export function defaultState() {
  return {
    salary: 280000,
    targetYear: 2035,
    inflation: 1.5,
    taxRate: 0,
    stepUp: 0,
    goal: 0,
    passiveTarget: 0,
    showReal: false,
    mcMode: false,
    tracking: [],
    placements: [
      makePlacement('sp500', 25000, 120000),
      makePlacement('msci-world', 18000, 0),
      makePlacement('fonds-euro', 12000, 240000),
    ],
    settings: {
      apiKey: '',
      mcRuns: 600,
      name: 'Dylan',
      objectiveLabel: 'Liberté financière',
    },
  };
}

export function loadState() {
  const d = defaultState();
  if (typeof localStorage === 'undefined') return d;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    const merged = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    // Un tableau vide est un choix volontaire (l'utilisateur a tout supprimé) :
    // on ne remet les placements par defaut que s'ils sont absents/invalides.
    merged.placements = Array.isArray(s.placements)
      ? s.placements.map((p) => ({ ...p, uid: uid++ }))
      : d.placements;
    return merged;
  } catch (e) {
    return d;
  }
}

export function saveState(s) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('horizon:save'));
  } catch (e) {
    /* ignore */
  }
}

export function resetState() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_KEY);
}

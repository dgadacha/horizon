import Anthropic from '@anthropic-ai/sdk';
import { PRESETS } from '../../lib/presets.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CHOICES = PRESETS.filter((p) => p.id !== 'custom');
const IDS = CHOICES.map((p) => p.id);
const CATALOG = CHOICES.map(
  (p) => `- ${p.id} : ${p.name}, rendement ~${p.meanReturn} %/an, volatilité ${p.volatility} %, ${p.desc}`
).join('\n');

const SYSTEM = `Tu es un conseiller patrimonial. On te donne un portefeuille EXISTANT, son analyse chiffrée et le profil de l'investisseur. Ta mission : proposer une version CORRIGÉE de la répartition qui répond aux points faibles identifiés (diversification, sur-exposition, risque vs horizon, performance vs inflation), tout en gardant le même budget total investi.

Règles :
- Garde 3 à 6 placements, allocations entières qui somment à 100 ; jamais 100 % sur un seul placement.
- Tu peux retirer un placement, en ajouter, ou ajuster les pourcentages — mais reste cohérent avec l'horizon et la tolérance au risque déclarés.
- Si le portefeuille est déjà bon, fais des ajustements MINEURS plutôt que de tout changer (ne corrige pas pour corriger).
- N'utilise QUE les placements du catalogue ci-dessous.

Réponds UNIQUEMENT par un objet JSON valide, sans aucun texte autour, exactement au format :
{"summary":"<= 40 mots, à la 2e personne (« tu »), explique CE QUI CHANGE et POURQUOI>","placements":[{"presetId":"<id>","allocation":<entier>,"rationale":"<= 12 mots, rôle de ce placement>"}]}

Catalogue disponible (UNIQUEMENT ceux-ci) :
${CATALOG}`;

function buildPrompt(d) {
  const cur = (d.placements || [])
    .map((p) => `- ${p.name} (${p.presetId}) : ${p.allocation} % du portefeuille, rendement net ${p.netReturn} %, volatilité ${p.volatility} %`)
    .join('\n');
  return `Portefeuille actuel (Nouvelle-Calédonie, montants en XPF) :
${cur || '(vide)'}

Analyse chiffrée actuelle :
- Score patrimoine : ${d.note}/10
- Diversification : ${d.diversif}
- Niveau de risque : ${d.risk}
- Volatilité moyenne pondérée : ${d.weightedVol} %
- Part en actions : ${d.equityShare} %

Profil & objectif :
- Salaire net mensuel : ${d.salary} XPF
- Épargne totale investie : ${d.totalMonthly} XPF/mois
- Horizon : ${d.years} ans (année cible ${d.targetYear})
- Patrimoine projeté à l'horizon : ${d.finalRealistic} XPF
- Objectif : ${d.goal || 0} XPF
- Inflation : ${d.inflation} %/an

Propose la répartition corrigée la plus adaptée pour rapprocher l'investisseur de son objectif sans incohérence risque/horizon.`;
}

function extractJson(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const body = t.slice(start, end + 1);
  try { return JSON.parse(body); } catch {}
  try { return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1')); } catch {}
  return null;
}

export async function POST({ request }) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const apiKey =
    (typeof data.apiKey === 'string' && data.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY ||
    import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'no_key', message: "Aucune clé API. Ajoute ta clé Claude dans les Paramètres." });
  }

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1536,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(data) }],
    });
    if (msg.stop_reason === 'refusal') return json({ error: 'refusal', message: "Correction impossible." });

    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.placements)) {
      const cut = msg.stop_reason === 'max_tokens';
      return json({ error: 'parse', message: cut ? "Réponse trop longue, réessaie." : "Réponse de l'IA illisible, réessaie." }, 502);
    }

    // Valide + normalise les allocations à 100
    const seen = new Map();
    for (const p of parsed.placements) {
      if (!IDS.includes(p.presetId)) continue;
      const alloc = Math.max(0, +p.allocation || 0);
      if (alloc <= 0) continue;
      if (seen.has(p.presetId)) seen.get(p.presetId).allocation += alloc;
      else seen.set(p.presetId, { presetId: p.presetId, allocation: alloc, rationale: String(p.rationale || '').slice(0, 90) });
    }
    let out = [...seen.values()];
    if (out.length === 0) return json({ error: 'empty', message: "Aucune correction valide générée." }, 502);
    const total = out.reduce((s, p) => s + p.allocation, 0) || 1;
    out = out.map((p) => ({ ...p, allocation: Math.round((p.allocation / total) * 100) }));
    const diff = 100 - out.reduce((s, p) => s + p.allocation, 0);
    if (diff !== 0) out.sort((x, y) => y.allocation - x.allocation)[0].allocation += diff;

    return json({ summary: String(parsed.summary || '').slice(0, 400), placements: out });
  } catch (e) {
    const status = e?.status;
    let message = e?.message?.slice(0, 140) || "Erreur lors de l'appel à Claude.";
    if (status === 401) message = "Clé API refusée. Vérifie-la dans les Paramètres.";
    return json({ error: 'api_error', message }, 502);
  }
}

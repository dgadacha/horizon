import Anthropic from '@anthropic-ai/sdk';
import { PRESETS } from '../../lib/presets.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CHOICES = PRESETS.filter((p) => p.id !== 'custom');
const IDS = CHOICES.map((p) => p.id);

// Catégories de placements sélectionnables par l'utilisateur → ids du catalogue
const CATEGORY_IDS = {
  etf: ['sp500', 'msci-world', 'nasdaq100', 'stoxx600', 'emerging', 'world-acc'],
  immo: ['scpi'],
  or: ['gold'],
  obligations: ['bonds'],
  'fonds-euro': ['fonds-euro', 'livret-a'],
  crypto: ['crypto'],
};

function catalogFor(allowed) {
  return CHOICES.filter((p) => allowed.includes(p.id))
    .map((p) => `- ${p.id} : ${p.name}, rendement ~${p.meanReturn} %/an, volatilité ${p.volatility} %, ${p.desc}`)
    .join('\n');
}

const SYSTEM = `Tu es un assistant pédagogique qui (1) propose un montant d'épargne mensuelle réaliste et (2) une répartition d'investissement TYPE adaptée à un profil. Tu choisis parmi un catalogue de placements et attribues une allocation en %.

Épargne recommandée (recommendedMonthly) :
- Calcule-la à partir du revenu et des dépenses (surplus = salaire - loyer - autres dépenses).
- Ne JAMAIS dépasser le surplus disponible. Garde une marge de sécurité : recommande en général 50 à 80 % du surplus (plus prudent si surplus faible ou profil prudent, plus ambitieux si profil dynamique/agressif et bon surplus).
- Si le surplus est nul ou négatif, recommande 0 et explique-le dans le résumé.
- Arrondis à un montant rond (ex. multiples de 5 000 XPF).

Tu proposes TROIS stratégies distinctes pour le MÊME profil, du plus sûr au plus offensif :
- "prudent" : sécurité dominante (fonds-euro, livret-a, bonds), faible volatilité.
- "equilibre" : mix actions/sécurité, le bon compromis.
- "croissance" : majorité d'actions diversifiées (sp500, msci-world, nasdaq100, emerging), volatilité assumée.
Mets en avant celle qui correspond le mieux au profil déclaré via un meilleur score de confiance.

Chaque stratégie :
- 3 à 5 placements, allocations entières qui somment à 100 ; jamais 100 % sur un seul placement.
- Adapte au mieux à l'horizon (long → plus d'actions) et à la cohérence risque/réaction.
- riskProfile : libellé ÉPURÉ et premium, surtout PAS une concaténation de variables. Exemples : « Profil croissance long terme », « Stratégie orientée performance », « Profil équilibré », « Profil prudent ». 2 à 4 mots, pas d'âge ni d'horizon dedans.
- confidence : adéquation au profil de l'utilisateur, entier 60-98.
- summary : <= 45 mots, à la 2e personne (« tu »), ton de conseiller : justifie le choix en t'appuyant sur le profil (âge, horizon, objectif, tolérance) ET la logique d'allocation. Le rappel « performances passées ≠ futures, pas un conseil perso » apparaît UNE seule fois, dans la stratégie équilibrée.

Si un objectif chiffré (revenu passif / capital cible) est fourni, ajuste la cohérence : un objectif ambitieux au regard de l'horizon et du surplus justifie une stratégie plus offensive (croissance) avec une meilleure confidence sur celle-ci. Dans le summary de la stratégie équilibrée, signale honnêtement si l'objectif paraît hors de portée au rythme proposé (il faudra épargner davantage ou allonger l'horizon) — sans jamais dépasser le surplus.

recommendedMonthly est commun aux trois stratégies (basé sur le surplus, marge de sécurité).
N'utilise QUE les placements du catalogue ci-dessous (l'utilisateur a choisi ces catégories).

Réponds UNIQUEMENT par un objet JSON valide, sans aucun texte autour, exactement au format :
{"recommendedMonthly":<entier XPF>,"targetYear":<entier>,"strategies":[{"key":"prudent","label":"Prudent","riskProfile":"<libellé épuré>","confidence":<entier>,"summary":"<texte>","placements":[{"presetId":"<id>","allocation":<entier>,"rationale":"<= 12 mots>"}]},{"key":"equilibre","label":"Équilibré","riskProfile":"...","confidence":...,"summary":"...","placements":[...]},{"key":"croissance","label":"Croissance","riskProfile":"...","confidence":...,"summary":"...","placements":[...]}]}`;

function buildPrompt(a) {
  const surplus = Math.max(0, (+a.salary || 0) - (+a.rent || 0) - (+a.expenses || 0));
  return `Profil de l'investisseur (Nouvelle-Calédonie, montants en XPF) :
- Âge : ${a.age}
- Salaire net mensuel : ${a.salary} XPF
- Loyer / crédit logement : ${a.rent || 0} XPF/mois
- Autres dépenses récurrentes : ${a.expenses || 0} XPF/mois
- Surplus disponible (salaire - dépenses) : ${surplus} XPF/mois  ← plafond ABSOLU pour recommendedMonthly
- Capital déjà disponible : ${a.initial || 0} XPF
- Horizon : ${a.horizonYears} ans (année cible ${a.targetYear})
- Profil de risque déclaré : ${a.risk}
- Réaction à une baisse de -30 % : ${a.reaction}
- Objectif principal : ${a.objective}${
    +a.passiveTarget > 0
      ? `\n- Objectif chiffré : toucher ${a.passiveTarget} XPF/mois de revenu passif, soit un capital cible d'environ ${a.goal} XPF (règle des 4 %)`
      : +a.goal > 0
        ? `\n- Objectif chiffré : atteindre un capital d'environ ${a.goal} XPF`
        : ''
  }

Propose l'épargne mensuelle conseillée (<= ${surplus}) et la répartition la plus adaptée.`;
}

function extractJson(text) {
  let t = (text || '').trim();
  // retire d'éventuelles balises de code ```json ... ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const body = t.slice(start, end + 1);
  try { return JSON.parse(body); } catch {}
  // tentative de réparation : virgules traînantes
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

  const a = data.answers || {};
  const client = new Anthropic({ apiKey });

  // Catégories choisies par l'utilisateur → placements autorisés
  const cats = Array.isArray(a.categories) ? a.categories : [];
  let allowed = cats.length ? [...new Set(cats.flatMap((c) => CATEGORY_IDS[c] || []))] : IDS;
  if (allowed.length === 0) allowed = IDS;
  const system = `${SYSTEM}\n\nCatalogue disponible (UNIQUEMENT ceux-ci) :\n${catalogFor(allowed)}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 3072,
      system,
      messages: [{ role: 'user', content: buildPrompt(a) }],
    });
    if (msg.stop_reason === 'refusal') return json({ error: 'refusal', message: "Génération impossible." });

    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    // Tolérance : accepte aussi l'ancien format mono-portefeuille (placements au top niveau)
    const rawStrategies = Array.isArray(parsed?.strategies)
      ? parsed.strategies
      : Array.isArray(parsed?.placements)
        ? [{ key: 'reco', label: 'Recommandé', riskProfile: parsed.riskProfile, confidence: parsed.confidence, summary: parsed.summary, placements: parsed.placements }]
        : null;
    if (!rawStrategies) {
      const cut = msg.stop_reason === 'max_tokens';
      return json({ error: 'parse', message: cut ? "Réponse trop longue, réessaie." : "Réponse de l'IA illisible, réessaie." }, 502);
    }

    // Valide + normalise les allocations d'une stratégie à 100
    function normalize(placements) {
      const seen = new Map();
      for (const p of placements || []) {
        if (!allowed.includes(p.presetId)) continue;
        const alloc = Math.max(0, +p.allocation || 0);
        if (alloc <= 0) continue;
        if (seen.has(p.presetId)) seen.get(p.presetId).allocation += alloc;
        else seen.set(p.presetId, { presetId: p.presetId, allocation: alloc, rationale: String(p.rationale || '').slice(0, 90) });
      }
      let out = [...seen.values()];
      if (out.length === 0) return null;
      const total = out.reduce((s, p) => s + p.allocation, 0) || 1;
      out = out.map((p) => ({ ...p, allocation: Math.round((p.allocation / total) * 100) }));
      const diff = 100 - out.reduce((s, p) => s + p.allocation, 0);
      if (diff !== 0) out.sort((x, y) => y.allocation - x.allocation)[0].allocation += diff;
      return out;
    }

    const strategies = rawStrategies
      .map((st) => {
        const placements = normalize(st.placements);
        if (!placements) return null;
        return {
          key: String(st.key || st.label || '').slice(0, 20),
          label: String(st.label || st.key || 'Stratégie').slice(0, 24),
          riskProfile: String(st.riskProfile || st.label || '').slice(0, 60),
          confidence: Math.min(98, Math.max(50, Math.round(+st.confidence || 85))),
          summary: String(st.summary || '').slice(0, 600),
          placements,
        };
      })
      .filter(Boolean);
    if (strategies.length === 0) return json({ error: 'empty', message: "Aucune stratégie valide générée." }, 502);

    // Épargne recommandée : plafonnée au surplus disponible
    const surplus = Math.max(0, (+a.salary || 0) - (+a.rent || 0) - (+a.expenses || 0));
    let reco = Math.max(0, Math.round(+parsed.recommendedMonthly || 0));
    if (reco > surplus) reco = surplus;

    return json({
      recommendedMonthly: reco,
      targetYear: parsed.targetYear || a.targetYear,
      strategies,
    });
  } catch (e) {
    const status = e?.status;
    let message = e?.message?.slice(0, 140) || "Erreur lors de l'appel à Claude.";
    if (status === 401) message = "Clé API refusée. Vérifie-la dans les Paramètres.";
    return json({ error: 'api_error', message }, 502);
  }
}

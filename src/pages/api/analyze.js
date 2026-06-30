import Anthropic from '@anthropic-ai/sdk';

// Cette route tourne cote serveur (pas de pre-rendu) pour garder la cle API secrete.
export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SYSTEM = `Tu es un assistant pedagogique en culture financiere, pour un utilisateur en Nouvelle-Caledonie (monnaie : franc Pacifique, XPF/FCFP).
Tu analyses un portefeuille d'epargne/investissement simule. Ton role est EDUCATIF et GENERAL :
- explique la diversification, le niveau de risque, l'adequation avec l'horizon de temps ;
- commente la repartition entre classes d'actifs et l'effet de l'inflation ;
- donne 3 a 4 observations concretes et actionnables, formulees comme des pistes de reflexion.
Regles strictes :
- NE DONNE PAS de conseil en investissement personnalise (pas d'ordre "achete/vends tel produit").
- Rappelle que les performances passees ne prejugent pas du futur.
- Reponds en francais, en Markdown, concis (250 mots max), avec des montants en XPF.
- Termine par une phrase rappelant que ce n'est pas un conseil financier reglemente.`;

function buildPrompt(d) {
  const lignes = (d.placements || [])
    .map(
      (p) =>
        `- ${p.name} : ${Math.round(p.monthly).toLocaleString('fr-FR')} XPF/mois, capital de depart ${Math.round(
          p.initial,
        ).toLocaleString('fr-FR')} XPF, rendement net ~${p.netReturn}%/an, volatilite ${p.volatility}%`,
    )
    .join('\n');

  return `Voici mon portefeuille a simuler jusqu'en ${d.targetYear} (horizon ${d.years} ans).
Salaire net mensuel : ${Math.round(d.salary).toLocaleString('fr-FR')} XPF.
Epargne totale : ${Math.round(d.totalMonthly).toLocaleString('fr-FR')} XPF/mois (taux d'epargne ${d.savingsRate}%).
Inflation supposee : ${d.inflation}%/an.

Placements :
${lignes}

Projection scenario realiste en ${d.targetYear} : ${Math.round(d.finalRealistic).toLocaleString('fr-FR')} XPF
(dont ${Math.round(d.invested).toLocaleString('fr-FR')} XPF verses, soit une plus-value de ${Math.round(
    d.finalRealistic - d.invested,
  ).toLocaleString('fr-FR')} XPF).
${d.goal ? `Objectif vise : ${Math.round(d.goal).toLocaleString('fr-FR')} XPF.` : ''}

Analyse ce portefeuille (diversification, risque, horizon, inflation) et donne-moi des pistes de reflexion.`;
}

export async function POST({ request }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Requete invalide.' }, 400);
  }

  // Priorite a la cle saisie dans la page Parametres, sinon variable d'environnement.
  const apiKey =
    (typeof data.apiKey === 'string' && data.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY ||
    import.meta.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return json({
      error: 'no_key',
      message:
        "Aucune cle API configuree. Ajoute ta cle dans la page Parametres, ou definis ANTHROPIC_API_KEY.",
    });
  }

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(data) }],
    });

    if (msg.stop_reason === 'refusal') {
      return json({ error: 'refusal', message: "L'analyse n'a pas pu etre generee." });
    }

    const text = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return json({ analysis: text });
  } catch (e) {
    return json({ error: 'api_error', message: e?.message || 'Erreur lors de l’appel a Claude.' }, 502);
  }
}

import Anthropic from '@anthropic-ai/sdk';

// Valide une cle API sans consommer de tokens : un simple appel a l'API Models
// (lecture des metadonnees du modele) suffit a verifier l'authentification.
export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request', message: 'Requete invalide.' }, 400);
  }

  const apiKey =
    (typeof data.apiKey === 'string' && data.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY ||
    import.meta.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return json({ ok: false, error: 'no_key', message: 'Aucune cle a tester.' });
  }

  const client = new Anthropic({ apiKey });
  try {
    const model = await client.models.retrieve('claude-haiku-4-5');
    return json({ ok: true, message: `Cle valide — acces a ${model.display_name || model.id} confirme.` });
  } catch (e) {
    const status = e?.status;
    let message = "Cle invalide ou erreur d'authentification.";
    if (status === 401) message = 'Cle refusee (authentification invalide).';
    else if (status === 403) message = "Cle valide mais sans acces au modele requis.";
    else if (status === 429) message = 'Cle valide, mais limite de requetes atteinte (reessaie).';
    else if (e?.message) message = e.message.slice(0, 140);
    return json({ ok: false, error: 'invalid', message });
  }
}

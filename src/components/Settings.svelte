<script>
  import { onMount } from 'svelte';
  import { loadState, saveState, defaultState, resetState, CURRENT_YEAR } from '../lib/store.js';

  let state = null;
  let ready = false;
  let showKey = false;
  let savedFlash = false;
  let fileInput;

  let testing = false;
  let testResult = null; // { ok, message }

  async function testKey() {
    testing = true;
    testResult = null;
    try {
      const res = await fetch('/api/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: state.settings.apiKey }),
      });
      const data = await res.json();
      testResult = { ok: !!data.ok, message: data.message };
    } catch (e) {
      testResult = { ok: false, message: "Impossible de contacter le serveur." };
    } finally {
      testing = false;
    }
  }

  onMount(() => {
    state = loadState();
    ready = true;
  });
  $: if (ready && state) saveState(state);
  $: years = ready ? state.targetYear - CURRENT_YEAR : 0;

  function flash() { savedFlash = true; setTimeout(() => (savedFlash = false), 1500); }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'horizon-export.json'; a.click();
    URL.revokeObjectURL(url);
  }
  function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { saveState(JSON.parse(reader.result)); state = loadState(); flash(); }
      catch (err) { alert('Fichier invalide.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
  function doReset() {
    if (!confirm('Réinitialiser tous les paramètres et actifs aux valeurs par défaut ?')) return;
    resetState(); state = defaultState(); flash();
  }
</script>

{#if ready}
  <div class="stack">
    <!-- Profil -->
    <section class="panel">
      <div class="panel-head"><h2>Profil</h2></div>
      <div class="two">
        <label class="field tight"><span>Nom affiché</span><input class="plain" type="text" bind:value={state.settings.name} placeholder="Ton nom" /></label>
        <label class="field tight"><span>Intitulé de l'objectif</span><input class="plain" type="text" bind:value={state.settings.objectiveLabel} placeholder="Liberté financière" /></label>
      </div>
    </section>

    <!-- Acces IA -->
    <section class="panel">
      <div class="panel-head"><h2>Accès à l'analyse</h2></div>
      <p class="muted-text" style="margin-top:-.5rem;margin-bottom:1.1rem">
        Une clé Claude permet de générer l'analyse patrimoniale détaillée. Elle est stockée <strong style="color:var(--ink)">localement dans ce navigateur</strong>
        et transmise uniquement à ton serveur local. Disponible sur
        <a class="inline-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.
      </p>
      <div class="key-row">
        {#if showKey}
          <input class="text-input" type="text" placeholder="sk-ant-..." bind:value={state.settings.apiKey} on:input={() => (testResult = null)} />
        {:else}
          <input class="text-input" type="password" placeholder="sk-ant-..." bind:value={state.settings.apiKey} on:input={() => (testResult = null)} />
        {/if}
        <button class="btn ghost" on:click={() => (showKey = !showKey)}>{showKey ? 'Masquer' : 'Afficher'}</button>
        <button class="btn" on:click={testKey} disabled={testing || !state.settings.apiKey}>{testing ? 'Test…' : 'Tester'}</button>
      </div>
      {#if testResult}
        <p class="test-result" class:ok={testResult.ok} class:ko={!testResult.ok}>
          <span class="ti">{testResult.ok ? '✓' : '✕'}</span> {testResult.message}
        </p>
      {/if}
      <p class="status">
        {#if state.settings.apiKey}<span class="dot on"></span> Clé enregistrée ({state.settings.apiKey.length} caractères){:else}<span class="dot off"></span> Aucune clé — analyse détaillée indisponible{/if}
        {#if savedFlash}<span class="flash">Enregistré</span>{/if}
      </p>
      <p class="muted-text" style="margin-top:.6rem">Alternative : variable d'environnement <code>ANTHROPIC_API_KEY</code> au lancement du serveur.</p>
    </section>

    <!-- Hypotheses -->
    <section class="panel">
      <div class="panel-head"><h2>Hypothèses de simulation</h2></div>
      <div class="params">
        <label class="field tight"><span>Salaire net mensuel</span><div class="input-eur"><input type="number" min="0" step="5000" bind:value={state.salary} /><em>XPF</em></div></label>
        <label class="field tight"><span>Horizon : <strong>{state.targetYear}</strong> ({years} ans)</span><input class="slider" type="range" min={CURRENT_YEAR + 1} max="2065" bind:value={state.targetYear} /></label>
        <label class="field tight"><span>Inflation estimée : <strong>{state.inflation} %</strong>/an</span><input class="slider" type="range" min="0" max="6" step="0.1" bind:value={state.inflation} /></label>
        <label class="field tight"><span>Impôt sur plus-value : <strong>{state.taxRate} %</strong></span><input class="slider" type="range" min="0" max="40" step="1" bind:value={state.taxRate} /></label>
        <label class="field tight"><span>Versements progressifs : <strong>+{state.stepUp} %</strong>/an</span><input class="slider" type="range" min="0" max="10" step="0.5" bind:value={state.stepUp} /></label>
        <label class="field tight"><span>Tirages Monte-Carlo : <strong>{state.settings.mcRuns}</strong></span><input class="slider" type="range" min="100" max="2000" step="100" bind:value={state.settings.mcRuns} /></label>
      </div>
      <p class="muted-text" style="margin-top:.2rem">Augmente automatiquement tes versements chaque année (ex. avec ton salaire). C'est l'un des leviers les plus puissants sur le long terme.</p>
    </section>

    <!-- Donnees -->
    <section class="panel">
      <div class="panel-head"><h2>Mes données</h2></div>
      <p class="muted-text" style="margin-top:-.5rem;margin-bottom:1.1rem">Tes données restent sur cet appareil. Exporte-les pour les sauvegarder ou les transférer.</p>
      <div class="actions">
        <button class="btn" on:click={exportData}>Exporter</button>
        <button class="btn ghost" on:click={() => fileInput.click()}>Importer</button>
        <input type="file" accept="application/json" bind:this={fileInput} on:change={importData} style="display:none" />
        <button class="btn danger" on:click={doReset}>Réinitialiser</button>
      </div>
    </section>
  </div>
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<style>
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; }
  .plain { width: 100%; background: rgba(255,255,255,.02); border: 1px solid var(--line); color: var(--ink); font-size: 1rem; padding: .8rem 1rem; border-radius: 12px; outline: none; font-family: inherit; }
  .plain:focus { border-color: var(--line-strong); }

  .key-row { display: flex; gap: .7rem; align-items: center; }
  .key-row .text-input { flex: 1; }
  .status { font-size: .85rem; color: #c8c8c8; margin: .9rem 0 0; display: flex; align-items: center; gap: .55rem; }
  .status .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .status .on { background: #fff; }
  .status .off { background: var(--faint); }
  .flash { color: var(--ink); font-weight: 600; margin-left: .5rem; }
  code { background: rgba(255,255,255,.06); padding: .12rem .4rem; border-radius: 5px; font-size: .85em; }

  .test-result { font-size: .85rem; margin: .9rem 0 0; display: flex; align-items: center; gap: .5rem; line-height: 1.4; }
  .test-result .ti { font-weight: 700; }
  .test-result.ok { color: #c8c8c8; }
  .test-result.ok .ti { color: #fff; }
  .test-result.ko { color: #ff8080; }

  .params { display: grid; grid-template-columns: 1fr 1fr; gap: 1.3rem 1.8rem; }
  .actions { display: flex; gap: .7rem; flex-wrap: wrap; }

  @media (max-width: 640px) { .two, .params { grid-template-columns: 1fr; } }
</style>

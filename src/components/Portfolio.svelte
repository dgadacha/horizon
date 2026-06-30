<script>
  import { onMount } from 'svelte';
  import { PRESETS, getPreset } from '../lib/presets.js';
  import { loadState, saveState, makePlacement, CURRENT_YEAR } from '../lib/store.js';
  import { projectPortfolio, afterTax, blendedNetReturn, projectSimple, formatShort } from '../lib/finance.js';

  const grouped = new Intl.NumberFormat('fr-FR');
  const fmtNum = (v) => grouped.format(Math.round(v || 0));

  let state = null;
  let ready = false;
  let expanded = {};
  let dateInput = '';
  let valueInput = null;

  onMount(() => {
    state = loadState();
    ready = true;
    const now = new Date();
    dateInput = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  $: if (ready && state) saveState(state);

  // ---- Suivi réel vs plan ----
  $: blended = clean.length ? blendedNetReturn(clean) : 0;
  $: entries = ready ? [...(state.tracking || [])].sort((a, b) => a.date.localeCompare(b.date)) : [];
  function elapsedMonths(d1, d2) {
    const [y1, m1] = d1.split('-').map(Number);
    const [y2, m2] = d2.split('-').map(Number);
    return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
  }
  function expectedAt(date) {
    if (entries.length === 0) return null;
    const base = entries[0];
    return projectSimple(base.value, totalMonthly, blended, elapsedMonths(base.date, date), state.stepUp || 0);
  }
  $: trackRows = entries
    .map((e, i) => {
      const exp = i === 0 ? e.value : expectedAt(e.date);
      const delta = e.value - exp;
      const pct = exp > 0 ? (delta / exp) * 100 : 0;
      return { ...e, exp, delta, pct, isBase: i === 0 };
    })
    .reverse();
  $: latestTrack = trackRows[0];
  function addTracking() {
    if (!dateInput || valueInput === null || valueInput === '' || +valueInput < 0) return;
    const date = dateInput;
    const tracking = (state.tracking || []).filter((e) => e.date !== date);
    tracking.push({ date, value: +valueInput });
    state.tracking = tracking;
    state = state;
    valueInput = null;
  }
  function removeTracking(date) {
    state.tracking = (state.tracking || []).filter((e) => e.date !== date);
    state = state;
  }
  function fmtDate(d) {
    const [y, m] = d.split('-');
    const mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return `${mois[+m - 1]} ${y}`;
  }

  function addPlacement() {
    const p = makePlacement('msci-world', 10000, 0);
    state.placements = [...state.placements, p];
    expanded[p.uid] = true;
  }
  let pendingDelete = null;
  function askDelete(uid) { pendingDelete = uid; }
  function cancelDelete() { pendingDelete = null; }
  function confirmDelete() {
    state.placements = state.placements.filter((x) => x.uid !== pendingDelete);
    pendingDelete = null;
  }
  $: pendingName = pendingDelete !== null
    ? (() => { const p = state.placements.find((x) => x.uid === pendingDelete); return p ? getPreset(p.presetId).name : 'cet actif'; })()
    : '';
  function onKey(e) { if (e.key === 'Escape') { cancelDelete(); closeWizard(); } }

  // ---- Assistant IA : questionnaire de profil ----
  let wizOpen = false;
  let wizStep = 0;
  let wizLoading = false;
  let wizError = '';
  let proposal = null;
  let selectedStrategy = 1;
  const DEFAULT_CATS = ['etf', 'fonds-euro', 'obligations', 'or'];
  let answers = { age: '', salary: 0, rent: 0, expenses: 0, initial: 0, horizonYears: 0, risk: '', reaction: '', objective: '', categories: [...DEFAULT_CATS] };

  const AGES = ['18–25 ans', '26–35 ans', '36–45 ans', '46–55 ans', '56 ans et +'];
  const HORIZONS = [{ label: '5 ans', y: 5 }, { label: '10 ans', y: 10 }, { label: '15 ans', y: 15 }, { label: '20 ans', y: 20 }, { label: '25 ans et +', y: 28 }];
  const RISKS = ['Prudent — protéger mon capital', 'Équilibré — bon compromis', 'Dynamique — viser la croissance', 'Agressif — performance maximale'];
  const REACTIONS = ['Je vendrais pour limiter les pertes', "J'attendrais sans rien faire", "J'investirais davantage"];
  const OBJECTIVES = ['Préparer ma retraite', 'Constituer un capital', 'Atteindre la liberté financière', 'Financer un achat (immobilier…)'];
  const CATEGORIES = [
    { key: 'etf', label: 'ETF / Actions monde' },
    { key: 'fonds-euro', label: 'Fonds euro / sans risque' },
    { key: 'obligations', label: 'Obligations' },
    { key: 'or', label: 'Or' },
    { key: 'immo', label: 'Immobilier (SCPI)' },
    { key: 'crypto', label: 'Crypto' },
  ];
  const STEPS = 7;

  function toggleCategory(key) {
    answers.categories = answers.categories.includes(key) ? answers.categories.filter((c) => c !== key) : [...answers.categories, key];
  }
  function catLabel(key) { return (CATEGORIES.find((c) => c.key === key) || {}).label || key; }

  function openWizard() {
    answers = { age: '', salary: state.salary, rent: 0, expenses: 0, initial: clean.reduce((s, p) => s + p.initial, 0), horizonYears: Math.max(0, state.targetYear - CURRENT_YEAR), risk: '', reaction: '', objective: '', categories: [...DEFAULT_CATS] };
    wizStep = 0; proposal = null; wizError = ''; wizOpen = true;
  }
  function closeWizard() { wizOpen = false; }
  function next() { if (wizStep < STEPS - 1) wizStep++; }
  function prev() { if (wizStep > 0) wizStep--; }
  function pick(field, value) { answers[field] = value; answers = answers; if (wizStep < STEPS - 1) next(); }

  // Capacité d'épargne théorique = salaire - dépenses (l'IA reste sous ce plafond)
  $: surplus = Math.max(0, (+answers.salary || 0) - (+answers.rent || 0) - (+answers.expenses || 0));
  $: spentPct = (+answers.salary || 0) > 0 ? Math.min(100, (((+answers.rent || 0) + (+answers.expenses || 0)) / answers.salary) * 100) : 0;
  $: freePct = Math.max(0, 100 - spentPct);

  // Stratégie sélectionnée + sa projection patrimoniale
  $: cur = proposal ? proposal.strategies[selectedStrategy] : null;
  $: projectedWealth = cur ? stratProjection(cur) : 0;
  $: projSeries = cur ? buildSeries(cur) : [];

  // Stratégie recommandée (confiance max), décomposition investi/performance, risque
  $: recommendedIdx = proposal ? proposal.strategies.reduce((b, s, i, arr) => (s.confidence > arr[b].confidence ? i : b), 0) : -1;
  $: monthsTotal = proposal ? (proposal.targetYear - CURRENT_YEAR) * 12 : 0;
  $: investedTotal = proposal ? (+answers.initial || 0) + (proposal.recommendedMonthly || 0) * monthsTotal : 0;
  $: performance = Math.max(0, projectedWealth - investedTotal);
  function adequationLabel(c) { return c >= 85 ? 'Très adapté' : c >= 72 ? 'Bonne correspondance' : 'À considérer'; }
  function riskLevel(st) {
    const v = st.placements.reduce((s, p) => s + getPreset(p.presetId).volatility * (p.allocation / 100), 0);
    return v < 6 ? 1 : v < 11 ? 2 : v < 16 ? 3 : v < 22 ? 4 : 5;
  }
  function riskWord(lvl) { return lvl <= 2 ? 'Faible' : lvl === 3 ? 'Modéré' : 'Élevé'; }

  // Survol du graphique
  let hoverIdx = null;
  function onChartMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    hoverIdx = Math.round(frac * (projSeries.length - 1));
  }
  $: hoverFrac = hoverIdx !== null && projSeries.length > 1 ? hoverIdx / (projSeries.length - 1) : 0;
  $: hoverYFrac = hoverIdx !== null && projSeries.length > 1
    ? (() => { const mn = Math.min(...projSeries), mx = Math.max(...projSeries), sp = mx - mn || 1; return 1 - (projSeries[hoverIdx] - mn) / sp; })()
    : 0;
  $: hoverYear = hoverIdx !== null && proposal ? CURRENT_YEAR + Math.round(hoverFrac * (proposal.targetYear - CURRENT_YEAR)) : 0;
  $: yearTicks = proposal
    ? (() => { const span = proposal.targetYear - CURRENT_YEAR; const n = Math.min(6, span + 1); const t = []; for (let i = 0; i < n; i++) t.push(CURRENT_YEAR + Math.round((i / (n - 1)) * span)); return [...new Set(t)]; })()
    : [];

  $: stepValid =
    wizStep === 0 ? !!answers.age
    : wizStep === 1 ? answers.salary > 0
    : wizStep === 2 ? answers.horizonYears > 0
    : wizStep === 3 ? !!answers.risk
    : wizStep === 4 ? !!answers.reaction
    : wizStep === 5 ? !!answers.objective
    : wizStep === 6 ? answers.categories.length > 0
    : false;

  async function generate() {
    wizLoading = true; wizError = ''; proposal = null;
    const targetYear = CURRENT_YEAR + (answers.horizonYears || 10);
    try {
      const res = await fetch('/api/generate-portfolio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: state.settings.apiKey, answers: { ...answers, surplus, targetYear, goal: state.goal || 0, passiveTarget: state.passiveTarget || 0 } }),
      });
      const data = await res.json();
      if (data.strategies && data.strategies.length) {
        proposal = { ...data, targetYear: data.targetYear || targetYear, recommendedMonthly: data.recommendedMonthly ?? surplus };
        // sélectionne par défaut la stratégie la plus adaptée (confiance max)
        selectedStrategy = data.strategies.reduce((best, s, i, arr) => (s.confidence > arr[best].confidence ? i : best), 0);
      } else wizError = data.message || 'Génération impossible.';
    } catch (e) {
      wizError = 'Impossible de contacter le serveur.';
    } finally {
      wizLoading = false;
    }
  }

  function blendedReturn(placements) {
    return placements.reduce((s, p) => { const pr = getPreset(p.presetId); return s + (p.allocation / 100) * (pr.meanReturn - pr.ter); }, 0);
  }
  function stratProjection(st) {
    return projectSimple(+answers.initial || 0, proposal.recommendedMonthly || 0, blendedReturn(st.placements), (proposal.targetYear - CURRENT_YEAR) * 12, 0);
  }
  function buildSeries(st) {
    const r = Math.pow(1 + blendedReturn(st.placements) / 100, 1 / 12) - 1;
    const months = (proposal.targetYear - CURRENT_YEAR) * 12;
    const pmt = proposal.recommendedMonthly || 0;
    let cap = +answers.initial || 0;
    const arr = [cap];
    for (let m = 1; m <= months; m++) { cap = cap * (1 + r) + pmt; arr.push(cap); }
    const step = Math.max(1, Math.floor(arr.length / 48));
    const out = [];
    for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
    if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
    return out;
  }
  function linePts(arr, w = 300, h = 64) {
    if (!arr || arr.length < 2) return '';
    const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1;
    return arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
  }
  function areaPts(arr, w = 300, h = 64) { const p = linePts(arr, w, h); return p ? `0,${h} ${p} ${w},${h}` : ''; }

  function applyProposal() {
    const st = proposal.strategies[selectedStrategy];
    const mb = proposal.recommendedMonthly || 0;
    const ib = answers.initial || 0;
    state.placements = st.placements.map((p) => makePlacement(p.presetId, Math.round((mb * p.allocation) / 100), Math.round((ib * p.allocation) / 100)));
    state.salary = answers.salary;
    state.targetYear = proposal.targetYear;
    state = state;
    wizOpen = false;
  }
  function onPresetChange(p) {
    const preset = getPreset(p.presetId);
    p.name = preset.name; p.emoji = preset.emoji; p.color = preset.color;
    p.meanReturn = preset.meanReturn; p.volatility = preset.volatility; p.ter = preset.ter;
    state.placements = state.placements;
  }
  function toggle(uid) {
    expanded[uid] = !expanded[uid];
    expanded = expanded;
  }

  $: clean = ready
    ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, volatility: +p.volatility || 0, ter: +p.ter || 0 }))
    : [];
  $: totalMonthly = clean.reduce((s, p) => s + p.monthly, 0);
  $: savingsRate = ready && state.salary > 0 ? (totalMonthly / state.salary) * 100 : 0;
  $: result = ready ? projectPortfolio(clean, CURRENT_YEAR, state.targetYear, state.stepUp || 0) : null;
  $: months = result ? result.months : 0;
  $: byUid = result ? Object.fromEntries(state.placements.map((p, i) => [p.uid, result.perPlacement[i]])) : {};
</script>

{#if ready}
  <section class="panel suivi">
    <div class="panel-head">
      <h2>Suivi de progression</h2>
      {#if latestTrack && !latestTrack.isBase}
        <span class="badge {latestTrack.pct >= 0 ? 'pos' : 'neg'}">{latestTrack.pct >= 0 ? '↗ En avance' : '↘ En retard'} · {latestTrack.pct >= 0 ? '+' : ''}{latestTrack.pct.toFixed(1)} %</span>
      {/if}
    </div>
    {#if entries.length === 0}
      <p class="muted-text" style="margin-bottom:1.2rem">Enregistre la valeur réelle de ton portefeuille pour la comparer à ta trajectoire prévue. Le premier relevé sert de point de départ.</p>
    {:else if latestTrack && !latestTrack.isBase}
      <p class="track-headline">Au {fmtDate(latestTrack.date)}, tu as <strong>{fmtNum(latestTrack.value)} FCFP</strong> — {#if latestTrack.pct >= 0}<span class="pos-t">{fmtNum(latestTrack.delta)} FCFP de plus</span>{:else}<span class="neg-t">{fmtNum(-latestTrack.delta)} FCFP de moins</span>{/if} que prévu ({fmtNum(latestTrack.exp)} FCFP).</p>
    {:else}
      <p class="muted-text" style="margin-bottom:1.2rem">Point de départ enregistré. Ajoute un nouveau relevé plus tard pour suivre ton avance.</p>
    {/if}
    <div class="add-row">
      <input class="m-input" type="month" bind:value={dateInput} />
      <div class="input-eur"><input type="number" min="0" step="10000" placeholder="Valeur réelle" bind:value={valueInput} /><em>XPF</em></div>
      <button class="btn" on:click={addTracking}>Enregistrer</button>
    </div>
    {#if trackRows.length}
      <div class="track-list">
        {#each trackRows as r}
          <div class="track-row">
            <span class="tr-date">{fmtDate(r.date)}{#if r.isBase}<span class="base-tag">départ</span>{/if}</span>
            <span class="tr-real num">{fmtNum(r.value)} FCFP</span>
            {#if r.isBase}<span class="tr-exp">—</span>{:else}<span class="tr-exp num">prévu {fmtNum(r.exp)}</span><span class="badge {r.pct >= 0 ? 'pos' : 'neg'} sm">{r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)} %</span>{/if}
            <button class="del-mini" title="Supprimer" on:click={() => removeTracking(r.date)}>✕</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <div class="mini-row">
    <div class="mini"><span class="mini-label">Épargne mensuelle</span><span class="mini-val"><span class="num">{fmtNum(totalMonthly)}</span> FCFP</span></div>
    <div class="mini"><span class="mini-label">Taux d'épargne</span><span class="mini-val"><span class="num">{savingsRate.toFixed(0)}</span> %</span></div>
    <div class="mini"><span class="mini-label">Actifs</span><span class="mini-val num">{clean.length}</span></div>
    <div class="mini"><span class="mini-label">Projeté en {state.targetYear}</span><span class="mini-val"><span class="num">{fmtNum(result.totals.realistic[months] || 0)}</span> FCFP</span></div>
  </div>
  {#if savingsRate > 100}<p class="alert">Tu investis plus que ton salaire net. Ajuste tes versements ou ton salaire dans les Paramètres.</p>{/if}

  <div class="head-row">
    <div class="section-title">Mes actifs</div>
    <div class="head-actions">
      <button class="btn" on:click={addPlacement}>Ajouter un actif</button>
      <button class="btn primary" on:click={openWizard}>Générer avec l'IA</button>
    </div>
  </div>

  <div class="assets">
    {#each state.placements as p (p.uid)}
      <div class="asset" class:open={expanded[p.uid]} style="border-left:2px solid {getPreset(p.presetId).color}">
        <div class="asset-summary">
          <div class="as-left">
            <span class="as-name"><i class="adot" style="background:{getPreset(p.presetId).color}"></i>{getPreset(p.presetId).name}</span>
            <span class="as-sub num">{fmtNum(+p.monthly || 0)} FCFP/mois</span>
          </div>
          <div class="as-right">
            <span class="as-proj num">{byUid[p.uid] ? fmtNum(byUid[p.uid].final.realistic) : '—'} <span class="as-cur">FCFP</span></span>
            <span class="badge pos">+{(p.meanReturn - p.ter).toFixed(1)} %/an</span>
          </div>
          <button class="card-del" title="Supprimer cet actif" on:click={() => askDelete(p.uid)}>✕</button>
        </div>
        <button class="details-toggle" on:click={() => toggle(p.uid)}>
          {expanded[p.uid] ? 'Masquer les détails' : 'Voir les détails'}
          <span class="caret">{expanded[p.uid] ? '▴' : '▾'}</span>
        </button>

        {#if expanded[p.uid]}
          <div class="drawer">
            <label class="d-field">
              <span>Actif</span>
              <select bind:value={p.presetId} on:change={() => onPresetChange(p)}>
                {#each PRESETS as preset}<option value={preset.id}>{preset.name}</option>{/each}
              </select>
            </label>
            <div class="d-grid">
              <label class="d-field"><span>Versement / mois</span><div class="input-eur sm"><input type="number" min="0" step="1000" bind:value={p.monthly} /><em>XPF</em></div></label>
              <label class="d-field"><span>Capital de départ</span><div class="input-eur sm"><input type="number" min="0" step="10000" bind:value={p.initial} /><em>XPF</em></div></label>
            </div>
            {#if p.presetId === 'custom'}
              <div class="d-grid">
                <label class="d-field"><span>Rendement %/an</span><div class="input-eur sm"><input type="number" step="0.5" bind:value={p.meanReturn} /><em>%</em></div></label>
                <label class="d-field"><span>Volatilité %</span><div class="input-eur sm"><input type="number" step="1" bind:value={p.volatility} /><em>%</em></div></label>
              </div>
            {/if}
            {#if byUid[p.uid]}
              <div class="d-stats">
                <div class="ds"><span class="ds-k">Investi</span><span class="ds-v num">{fmtNum(byUid[p.uid].invested)}</span></div>
                <div class="ds"><span class="ds-k">Plus-value</span><span class="ds-v num pv">+{fmtNum(byUid[p.uid].final.realistic - byUid[p.uid].invested)}</span></div>
                <div class="ds"><span class="ds-k">Projection {state.targetYear}</span><span class="ds-v num">{fmtNum(byUid[p.uid].final.realistic)}</span></div>
              </div>
            {/if}
            <div class="d-meta">
              <div class="d-range">
                <span>Fourchette en {state.targetYear}</span>
                <strong class="num">{byUid[p.uid] ? fmtNum(byUid[p.uid].final.pessimistic) : '—'} → {byUid[p.uid] ? fmtNum(byUid[p.uid].final.optimistic) : '—'} FCFP</strong>
                {#if state.taxRate > 0 && byUid[p.uid]}<span class="d-tax num">{fmtNum(afterTax(byUid[p.uid].final.realistic, byUid[p.uid].invested, state.taxRate))} FCFP après impôt</span>{/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    {#if state.placements.length === 0}
      <p class="muted-text">Aucun actif. Ajoutes-en un pour lancer la projection.</p>
    {/if}
  </div>

  {#if pendingDelete !== null}
    <div class="modal-backdrop" on:click={cancelDelete} role="presentation">
      <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
        <div class="modal-icon">✕</div>
        <h3 class="modal-title">Supprimer cet actif ?</h3>
        <p class="modal-text"><strong>{pendingName}</strong> sera retiré de ton portefeuille. Tu pourras le rajouter à tout moment.</p>
        <div class="modal-actions">
          <button class="btn ghost" on:click={cancelDelete}>Annuler</button>
          <button class="btn delete" on:click={confirmDelete}>Supprimer</button>
        </div>
      </div>
    </div>
  {/if}

  {#if wizOpen}
    <div class="modal-backdrop" on:click={closeWizard} role="presentation">
      <div class="modal wizard" on:click|stopPropagation role="dialog" aria-modal="true">
        {#if !proposal && !wizLoading}
          <div class="wiz-head">
            <span class="wiz-step">Étape {wizStep + 1} sur {STEPS}</span>
            <button class="wiz-close" on:click={closeWizard} title="Fermer">✕</button>
          </div>
          <div class="wiz-prog"><div class="wiz-prog-fill" style="width:{((wizStep + 1) / STEPS) * 100}%"></div></div>
        {/if}

        <div class="wiz-body">
          {#if wizLoading}
            <div class="wiz-loading"><span class="spinner"></span><p>Claude construit ton portefeuille…</p></div>
          {:else if proposal && cur}
            <span class="rep-eyebrow">3 stratégies pour ton profil</span>
            <div class="strat-tabs">
              {#each proposal.strategies as st, i}
                <button class="strat-tab" class:sel={selectedStrategy === i} on:click={() => (selectedStrategy = i)}>
                  {#if i === recommendedIdx}<span class="strat-reco">Recommandé</span>{/if}
                  <span class="strat-label">{st.label}</span>
                  <span class="strat-proj num">{formatShort(stratProjection(st))}</span>
                </button>
              {/each}
            </div>

            <div class="rep-head">
              <h3 class="rep-profile">{cur.riskProfile}</h3>
              <div class="risk-meter" title="Niveau de risque">
                {#each [1, 2, 3, 4, 5] as d}<span class="risk-dot" class:on={d <= riskLevel(cur)}></span>{/each}
                <span class="risk-word">{riskWord(riskLevel(cur))}</span>
              </div>
            </div>

            <div class="rep-proj">
              <span class="rep-proj-label">Patrimoine projeté · {proposal.targetYear}</span>
              <div class="rep-proj-amount"><span class="num">{fmtNum(projectedWealth)}</span><span class="cur">FCFP</span></div>
              <div class="rep-breakdown">
                <span><span class="num">{fmtNum(investedTotal)}</span> investis</span>
                <span class="plus">+</span>
                <span class="perf"><span class="num">{fmtNum(performance)}</span> de performance</span>
              </div>
              <div class="rep-chart-wrap" on:mousemove={onChartMove} on:mouseleave={() => (hoverIdx = null)} role="presentation">
                <svg class="rep-chart" viewBox="0 0 300 64" preserveAspectRatio="none">
                  <polygon points={areaPts(projSeries)} fill="rgba(201,168,93,0.13)" />
                  <polyline points={linePts(projSeries)} fill="none" stroke="#c9a85d" stroke-width="2" vector-effect="non-scaling-stroke" />
                </svg>
                {#if hoverIdx !== null}
                  <div class="chart-guide" style="left:{hoverFrac * 100}%"></div>
                  <div class="chart-dot" style="left:{hoverFrac * 100}%;top:{hoverYFrac * 100}%"></div>
                  <div class="chart-tip" style="left:{hoverFrac * 100}%"><span class="tip-y">{hoverYear}</span><span class="tip-v num">{fmtNum(projSeries[hoverIdx])} FCFP</span></div>
                {/if}
              </div>
              <div class="rep-chart-axis">{#each yearTicks as y}<span>{y}</span>{/each}</div>
            </div>

            <div class="rep-why">Pourquoi « {cur.label} » ?</div>
            <p class="wiz-summary">{cur.summary}</p>

            <div class="rep-alloc-head"><span>Répartition {cur.label.toLowerCase()}</span>{#if cur.confidence}<span class="rep-conf">{adequationLabel(cur.confidence)}</span>{/if}</div>
            <div class="prop-list">
              {#each cur.placements as p}
                <div class="prop-row">
                  <span class="prop-dot" style="background:{getPreset(p.presetId).color}"></span>
                  <div class="prop-info">
                    <span class="prop-name">{getPreset(p.presetId).name}</span>
                    {#if p.rationale}<span class="prop-rat">{p.rationale}</span>{/if}
                  </div>
                  <span class="prop-alloc num">{p.allocation} %</span>
                </div>
              {/each}
            </div>
            {#if answers.categories && answers.categories.length}
              <p class="rep-cats">Placements considérés : {answers.categories.map(catLabel).join(' · ')}</p>
            {/if}
            <p class="prop-note">Épargne conseillée {fmtNum(proposal.recommendedMonthly)} FCFP/mois · capital {fmtNum(answers.initial)} FCFP · horizon {proposal.targetYear}. Tu pourras tout ajuster ensuite.</p>
            <div class="modal-actions">
              <button class="btn ghost" on:click={() => { proposal = null; wizStep = 0; }}>Recommencer</button>
              <button class="btn primary" on:click={applyProposal}>Appliquer « {cur.label} »</button>
            </div>
          {:else if wizStep === 0}
            <h3 class="wiz-q">Pour commencer, quel âge as-tu ?</h3>
            <div class="wiz-opts">{#each AGES as o}<button class="wiz-opt" class:sel={answers.age === o} on:click={() => pick('age', o)}>{o}</button>{/each}</div>
          {:else if wizStep === 1}
            <h3 class="wiz-q">Construisons ta situation financière</h3>
            <p class="wiz-sub">Pas besoin de calculer ton épargne — l'IA la déduira de tes revenus et dépenses.</p>
            <div class="wiz-fields">
              <label><span>Combien gagnes-tu chaque mois ?</span><div class="input-eur"><input type="number" min="0" step="5000" bind:value={answers.salary} /><em>XPF</em></div></label>
              <label><span>Combien te coûte ton logement ?</span><div class="input-eur"><input type="number" min="0" step="5000" bind:value={answers.rent} /><em>XPF</em></div></label>
              <label><span>Tes autres dépenses habituelles ? <span class="hint">(courses, factures, transport, abonnements…)</span></span><div class="input-eur"><input type="number" min="0" step="5000" bind:value={answers.expenses} /><em>XPF</em></div></label>
              <label><span>Un capital déjà disponible à investir ?</span><div class="input-eur"><input type="number" min="0" step="10000" bind:value={answers.initial} /><em>XPF</em></div></label>
            </div>
            {#if answers.salary > 0}
              <div class="fin-viz">
                <div class="fin-bar">
                  <div class="fin-seg spent" style="width:{spentPct}%"></div>
                  <div class="fin-seg free" style="width:{freePct}%"></div>
                </div>
                <p class="fin-note">Il te reste environ <strong>{fmtNum(surplus)} FCFP</strong> chaque mois — l'IA proposera une épargne adaptée en gardant une marge.</p>
              </div>
            {/if}
          {:else if wizStep === 2}
            <h3 class="wiz-q">Quand penses-tu utiliser cet argent pour la première fois ?</h3>
            <div class="wiz-opts">{#each HORIZONS as o}<button class="wiz-opt" class:sel={answers.horizonYears === o.y} on:click={() => pick('horizonYears', o.y)}>{o.label}</button>{/each}</div>
          {:else if wizStep === 3}
            <h3 class="wiz-q">Comment réagis-tu face aux fluctuations ?</h3>
            <p class="wiz-sub">Choisis l'affirmation qui te ressemble le plus.</p>
            <div class="wiz-opts col">{#each RISKS as o}<button class="wiz-opt" class:sel={answers.risk === o} on:click={() => pick('risk', o)}>{o}</button>{/each}</div>
          {:else if wizStep === 4}
            <h3 class="wiz-q">Imagine : ton portefeuille chute de 30 %. Tu fais quoi ?</h3>
            <div class="wiz-opts col">{#each REACTIONS as o}<button class="wiz-opt" class:sel={answers.reaction === o} on:click={() => pick('reaction', o)}>{o}</button>{/each}</div>
          {:else if wizStep === 5}
            <h3 class="wiz-q">Qu'est-ce qui compte le plus pour toi ?</h3>
            <div class="wiz-opts col">{#each OBJECTIVES as o}<button class="wiz-opt" class:sel={answers.objective === o} on:click={() => pick('objective', o)}>{o}</button>{/each}</div>
          {:else if wizStep === 6}
            <h3 class="wiz-q">Quels types de placements t'intéressent ?</h3>
            <p class="wiz-sub">Sélectionne les catégories à considérer. L'IA ne proposera que celles-ci.</p>
            <div class="wiz-chips">
              {#each CATEGORIES as c}
                <button class="wiz-chip" class:sel={answers.categories.includes(c.key)} on:click={() => toggleCategory(c.key)}>
                  <span class="chip-check">{answers.categories.includes(c.key) ? '✓' : ''}</span>{c.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if !proposal && !wizLoading}
          <div class="wiz-foot">
            <button class="btn ghost" on:click={prev} disabled={wizStep === 0}>Précédent</button>
            {#if wizStep < STEPS - 1}
              <button class="btn" on:click={next} disabled={!stepValid}>Suivant</button>
            {:else}
              <button class="btn primary" on:click={generate} disabled={!stepValid}>Générer mon portefeuille</button>
            {/if}
          </div>
        {/if}
        {#if wizError}<p class="wiz-error">{wizError} {#if wizError.toLowerCase().includes('clé') || wizError.toLowerCase().includes('cle')}<a class="inline-link" href="/parametres">Configurer la clé</a>{/if}</p>{/if}
      </div>
    </div>
  {/if}
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<svelte:window on:keydown={onKey} />

<style>
  .suivi { margin-bottom: 1.6rem; }
  .track-headline { font-size: 1.05rem; line-height: 1.55; color: #d8d8d8; margin: 0 0 1.3rem; }
  .track-headline strong { color: var(--ink); font-weight: 600; }
  .pos-t { color: var(--green); font-weight: 600; }
  .neg-t { color: var(--red); font-weight: 600; }
  .add-row { display: flex; gap: .7rem; align-items: stretch; flex-wrap: wrap; }
  .m-input { background: rgba(255,255,255,.02); border: 1px solid var(--line); color: var(--ink); border-radius: 12px; padding: .65rem .8rem; font-family: inherit; font-size: .92rem; outline: none; color-scheme: dark; }
  .m-input:focus { border-color: var(--line-strong); }
  .add-row .input-eur { flex: 1; min-width: 160px; }
  .badge.sm { font-size: .72rem; padding: .2rem .5rem; }
  .track-list { display: flex; flex-direction: column; margin-top: 1.3rem; }
  .track-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto auto; gap: 1rem; align-items: center; padding: .75rem 0; border-top: 1px solid var(--line); font-size: .9rem; }
  .tr-date { color: var(--ink); font-weight: 500; display: inline-flex; align-items: center; gap: .5rem; }
  .base-tag { font-size: .68rem; color: var(--muted); background: rgba(255,255,255,.06); padding: .12rem .45rem; border-radius: 999px; }
  .tr-real { font-weight: 600; text-align: right; }
  .tr-exp { color: var(--muted); text-align: right; font-size: .84rem; }
  .del-mini { background: none; border: none; color: var(--faint); cursor: pointer; font-size: .8rem; transition: color .15s; }
  .del-mini:hover { color: var(--red); }

  .mini-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; margin-bottom: 1.6rem; }
  .mini { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 1.35rem 1.45rem; }
  .mini-label { display: block; font-size: .82rem; color: var(--muted); margin-bottom: .6rem; }
  .mini-val { font-size: 1.65rem; font-weight: 600; letter-spacing: -.025em; }

  .head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.1rem; }
  .section-title { font-size: .95rem; font-weight: 600; }

  .assets { display: flex; flex-direction: column; gap: .9rem; }
  .asset { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 1.3rem 1.5rem; transition: border-color .15s; }
  .asset.open { border-color: var(--line-strong); }
  .asset-summary { display: flex; align-items: center; gap: 1.2rem; }
  .card-del { background: none; border: none; color: var(--faint); width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font-size: .8rem; flex-shrink: 0; transition: background .15s, color .15s; }
  .card-del:hover { background: rgba(255,80,80,.14); color: #ff8080; }
  .as-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .3rem; }
  .as-name { font-weight: 600; font-size: 1rem; display: inline-flex; align-items: center; }
  .adot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: .55rem; }
  .as-sub { font-size: .85rem; color: var(--muted); }
  .as-right { display: flex; flex-direction: column; align-items: flex-end; gap: .35rem; flex-shrink: 0; }
  .as-proj { font-size: 1.1rem; font-weight: 600; letter-spacing: -.02em; }
  .as-cur { font-size: .76rem; color: var(--muted); font-weight: 400; }
  .as-net { font-size: .82rem; color: var(--muted); }

  .details-toggle { margin-top: 1rem; background: none; border: none; color: var(--muted); font-size: .84rem; cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: .4rem; font-family: inherit; transition: color .15s; }
  .details-toggle:hover { color: var(--ink); }
  .caret { font-size: .7rem; }

  .drawer { margin-top: 1.3rem; padding-top: 1.3rem; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 1rem; }
  .d-field { display: block; }
  .d-field > span { display: block; font-size: .78rem; color: var(--muted); margin-bottom: .4rem; }
  .d-field select { width: 100%; background: rgba(255,255,255,.02); color: var(--ink); border: 1px solid var(--line); border-radius: 11px; padding: .65rem .8rem; font-size: .92rem; font-weight: 500; outline: none; cursor: pointer; font-family: inherit; }
  .d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .9rem; }
  .d-meta { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .d-range { display: flex; flex-direction: column; gap: .25rem; }
  .d-range span { font-size: .78rem; color: var(--muted); }
  .d-range strong { font-size: .92rem; font-weight: 600; }
  .d-tax { font-size: .8rem !important; color: var(--muted) !important; font-weight: 400 !important; }

  .d-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; padding: 1rem 0; border-top: 1px solid var(--line); }
  .ds { display: flex; flex-direction: column; gap: .3rem; }
  .ds-k { font-size: .76rem; color: var(--muted); }
  .ds-v { font-size: 1.05rem; font-weight: 600; letter-spacing: -.02em; }
  .ds-v.pv { color: var(--green); }

  /* Modal de confirmation */
  .modal-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: rgba(2,2,4,.65); backdrop-filter: blur(6px); animation: fade .15s ease; }
  .modal { width: 100%; max-width: 380px; max-height: calc(100dvh - 2.5rem); overflow-y: auto; background: var(--card); border: 1px solid var(--line-strong); border-radius: 20px; padding: 1.8rem; text-align: center; box-shadow: 0 24px 60px -20px rgba(0,0,0,.8); animation: pop .18s cubic-bezier(.2,.8,.3,1); }
  .modal::-webkit-scrollbar { width: 8px; }
  .modal::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 999px; }
  .modal-icon { width: 44px; height: 44px; margin: 0 auto 1.1rem; border-radius: 12px; background: rgba(183,107,107,.14); color: var(--red); display: flex; align-items: center; justify-content: center; font-size: .9rem; }
  .modal-title { font-size: 1.15rem; font-weight: 600; margin: 0 0 .6rem; letter-spacing: -.01em; }
  .modal-text { font-size: .9rem; color: var(--muted); line-height: 1.55; margin: 0 0 1.5rem; }
  .modal-text strong { color: var(--ink); font-weight: 600; }
  .modal-actions { display: flex; gap: .7rem; }
  .modal-actions .btn { flex: 1; justify-content: center; padding: .7rem; }
  .btn.delete { background: var(--red); border: none; color: #160a0a; font-weight: 600; }
  .btn.delete:hover { background: #c47a7a; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(.94) translateY(6px); } }

  /* ---- Wizard IA ---- */
  .head-actions { display: flex; gap: .6rem; }
  .modal.wizard { max-width: 540px; text-align: left; padding: 1.6rem 1.8rem 1.8rem; }
  /* Boutons du rapport toujours visibles pendant le défilement */
  .modal.wizard .modal-actions { position: sticky; bottom: -1.8rem; background: var(--card); margin: 1.4rem -1.8rem -1.8rem; padding: 1rem 1.8rem 1.8rem; border-top: 1px solid var(--line); }
  .wiz-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: .8rem; }
  .wiz-step { font-size: .8rem; color: var(--muted); }
  .wiz-close { background: none; border: none; color: var(--faint); cursor: pointer; font-size: .85rem; padding: .2rem; transition: color .15s; }
  .wiz-close:hover { color: var(--ink); }
  .wiz-prog { height: 3px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin-bottom: 1.7rem; }
  .wiz-prog-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .25s; }
  .wiz-body { min-height: 200px; }
  .wiz-q { font-size: 1.2rem; font-weight: 600; margin: 0 0 1.3rem; letter-spacing: -.01em; }

  .wiz-opts { display: flex; flex-wrap: wrap; gap: .6rem; }
  .wiz-opts.col { flex-direction: column; }
  .wiz-opt { text-align: left; background: rgba(255,255,255,.03); border: 1px solid var(--line); color: var(--ink); padding: .85rem 1rem; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: .92rem; transition: border-color .15s, background .15s; }
  .wiz-opt:hover { border-color: var(--line-strong); background: rgba(255,255,255,.05); }
  .wiz-opt.sel { border-color: var(--accent); background: rgba(201,168,93,.1); color: var(--ink); }

  .wiz-sub { font-size: .86rem; color: var(--muted); margin: -.6rem 0 1.2rem; line-height: 1.5; }
  .wiz-fields { display: flex; flex-direction: column; gap: 1rem; }
  .wiz-fields label > span { display: block; font-size: .84rem; color: var(--muted); margin-bottom: .5rem; }
  .wiz-fields .hint { color: var(--faint); font-size: .78rem; }
  .wiz-surplus { font-size: .84rem; color: var(--muted); margin: 1.1rem 0 0; }
  .wiz-surplus strong { color: var(--accent); font-weight: 600; }

  .fin-viz { margin-top: 1.2rem; }
  .fin-bar { display: flex; height: 9px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.06); }
  .fin-seg { height: 100%; }
  .fin-seg.spent { background: rgba(255,255,255,.18); }
  .fin-seg.free { background: var(--accent); }
  .fin-note { font-size: .84rem; color: var(--muted); margin: .7rem 0 0; line-height: 1.5; }
  .fin-note strong { color: var(--accent); font-weight: 600; }

  /* Rapport patrimonial (résultat) */
  .rep-eyebrow { font-size: .78rem; color: var(--muted); letter-spacing: .04em; }
  .strat-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; margin: .7rem 0 1.5rem; }
  .strat-tab { position: relative; display: flex; flex-direction: column; gap: .3rem; align-items: flex-start; text-align: left; background: rgba(255,255,255,.03); border: 1px solid var(--line); border-radius: 13px; padding: .8rem .9rem; cursor: pointer; font-family: inherit; transition: border-color .15s, background .15s; }
  .strat-reco { position: absolute; top: -8px; left: .7rem; font-size: .62rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #1a1405; background: var(--accent); padding: .12rem .4rem; border-radius: 999px; }
  .strat-tab:hover { border-color: var(--line-strong); }
  .strat-tab.sel { border-color: var(--accent); background: rgba(201,168,93,.1); }
  .strat-label { font-size: .85rem; font-weight: 600; color: var(--ink); }
  .strat-proj { font-size: .9rem; color: var(--muted); }
  .strat-tab.sel .strat-proj { color: var(--accent); }
  .rep-profile { font-size: 1.25rem; font-weight: 600; margin: .3rem 0 1.1rem; letter-spacing: -.02em; line-height: 1.25; }
  .rep-proj { padding: 1.2rem 1.3rem; background: rgba(201,168,93,.07); border: 1px solid rgba(201,168,93,.2); border-radius: 16px; margin-bottom: 1.2rem; }
  .rep-proj-label { font-size: .8rem; color: var(--muted); }
  .rep-proj-amount { display: flex; align-items: baseline; gap: .45rem; margin: .35rem 0 .3rem; }
  .rep-proj-amount .num { font-size: clamp(2.2rem, 6vw, 3.1rem); font-weight: 700; letter-spacing: -.035em; line-height: 1; color: var(--accent); }
  .rep-proj-amount .cur { font-size: .9rem; color: var(--muted); }
  .rep-proj-sub { font-size: .82rem; color: var(--muted); }
  .rep-chart { width: 100%; height: 64px; display: block; margin-top: 1.1rem; }
  .rep-chart-axis { display: flex; justify-content: space-between; font-size: .72rem; color: var(--muted); margin-top: .35rem; }
  .rep-alloc-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 .2rem; }
  .rep-alloc-head > span:first-child { font-size: .82rem; color: var(--muted); }
  .rep-conf { font-size: .74rem; font-weight: 600; color: var(--accent); background: rgba(201,168,93,.12); padding: .2rem .55rem; border-radius: 999px; }

  .rep-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: .3rem 0 1.1rem; }
  .rep-head .rep-profile { margin: 0; }
  .risk-meter { display: inline-flex; align-items: center; gap: .3rem; flex-shrink: 0; }
  .risk-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.14); }
  .risk-dot.on { background: var(--accent); }
  .risk-word { font-size: .76rem; color: var(--muted); margin-left: .3rem; }

  .rep-breakdown { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; font-size: .84rem; color: var(--muted); margin-top: .5rem; }
  .rep-breakdown .num { color: var(--ink); font-weight: 600; }
  .rep-breakdown .plus { color: var(--faint); }
  .rep-breakdown .perf .num { color: var(--green); }

  .rep-chart-wrap { position: relative; height: 64px; margin-top: 2.4rem; cursor: crosshair; }
  .chart-guide { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.2); transform: translateX(-0.5px); pointer-events: none; }
  .chart-dot { position: absolute; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 3px rgba(201,168,93,.2); }
  .chart-tip { position: absolute; top: -2.4rem; transform: translateX(-50%); background: #0a0a0c; border: 1px solid var(--line-strong); border-radius: 8px; padding: .35rem .55rem; display: flex; flex-direction: column; align-items: center; gap: .05rem; pointer-events: none; white-space: nowrap; }
  .chart-tip .tip-y { font-size: .68rem; color: var(--muted); }
  .chart-tip .tip-v { font-size: .8rem; font-weight: 600; color: var(--accent); }

  .rep-why { font-size: .82rem; font-weight: 600; color: var(--ink); margin-bottom: .5rem; }
  .rep-cats { font-size: .78rem; color: var(--muted); margin: .8rem 0 0; }

  .wiz-chips { display: flex; flex-wrap: wrap; gap: .6rem; }
  .wiz-chip { display: inline-flex; align-items: center; gap: .45rem; background: rgba(255,255,255,.03); border: 1px solid var(--line); color: var(--muted); padding: .6rem .9rem; border-radius: 999px; cursor: pointer; font-family: inherit; font-size: .88rem; transition: border-color .15s, color .15s, background .15s; }
  .wiz-chip:hover { border-color: var(--line-strong); color: var(--ink); }
  .wiz-chip.sel { border-color: var(--accent); background: rgba(201,168,93,.1); color: var(--ink); }
  .chip-check { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--line-strong); display: inline-flex; align-items: center; justify-content: center; font-size: .6rem; color: #1a1405; }
  .wiz-chip.sel .chip-check { background: var(--accent); border-color: var(--accent); }

  .wiz-foot { display: flex; justify-content: space-between; gap: .7rem; margin-top: 1.6rem; }
  .wiz-foot .btn { min-width: 120px; justify-content: center; }

  .wiz-loading { min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: var(--muted); }
  .wiz-loading .spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.18); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .wiz-summary { font-size: .9rem; line-height: 1.55; color: #c8c8c8; margin: 0 0 1.2rem; }
  .prop-list { display: flex; flex-direction: column; gap: .2rem; }
  .prop-row { display: flex; align-items: center; gap: .8rem; padding: .6rem 0; border-top: 1px solid var(--line); }
  .prop-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .prop-info { display: flex; flex-direction: column; gap: .15rem; flex: 1; min-width: 0; }
  .prop-name { font-weight: 600; font-size: .92rem; }
  .prop-rat { font-size: .78rem; color: var(--muted); }
  .prop-alloc { font-size: 1.05rem; font-weight: 700; }
  .prop-note { font-size: .8rem; color: var(--muted); margin: 1rem 0 1.4rem; line-height: 1.5; }
  .wiz-error { color: var(--red); font-size: .85rem; margin: 1rem 0 0; }

  @media (max-width: 760px) { .mini-row { grid-template-columns: 1fr 1fr; } .head-actions { flex-direction: column; } .track-row { grid-template-columns: 1fr auto auto; } .tr-exp { display: none; } }
</style>

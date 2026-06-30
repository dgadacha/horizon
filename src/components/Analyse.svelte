<script>
  import { onMount } from 'svelte';
  import { loadState, saveState, CURRENT_YEAR } from '../lib/store.js';
  import { projectPortfolio, analyzePortfolio } from '../lib/finance.js';

  const grouped = new Intl.NumberFormat('fr-FR');
  const fmtNum = (v) => grouped.format(Math.round(v || 0));

  let state = null;
  let ready = false;

  onMount(() => {
    state = loadState();
    ready = true;
  });
  $: if (ready && state) saveState(state);

  $: years = ready ? state.targetYear - CURRENT_YEAR : 0;
  $: clean = ready
    ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, volatility: +p.volatility || 0, ter: +p.ter || 0 }))
    : [];
  $: totalMonthly = clean.reduce((s, p) => s + p.monthly, 0);
  $: savingsRate = ready && state.salary > 0 ? (totalMonthly / state.salary) * 100 : 0;
  $: result = ready ? projectPortfolio(clean, CURRENT_YEAR, state.targetYear, state.stepUp || 0) : null;
  $: months = result ? result.months : 0;
  $: a = result ? analyzePortfolio({ savingsRate, placements: clean, years, perPlacement: result.perPlacement }) : null;

  const DONUT_R = 46;
  const DONUT_C = 2 * Math.PI * DONUT_R;
  $: segs = a
    ? (() => {
        let acc = 0;
        return a.allocs.map((it) => {
          const len = (it.alloc / 100) * DONUT_C;
          const o = -acc;
          acc += len;
          return { color: it.color, len, offset: o };
        });
      })()
    : [];

  let aiLoading = false, aiResult = '', aiError = '';
  function mdToHtml(text) {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>')
      .replace(/<\/ul><br><ul>/g, '');
  }
  async function analyze() {
    aiLoading = true; aiError = ''; aiResult = '';
    try {
      const payload = {
        apiKey: state.settings.apiKey,
        salary: state.salary, totalMonthly, savingsRate: savingsRate.toFixed(0),
        inflation: state.inflation, targetYear: state.targetYear, years,
        invested: result.invested[months] || 0, finalRealistic: result.totals.realistic[months] || 0, goal: state.goal,
        placements: clean.map((p) => ({ name: p.name, monthly: p.monthly, initial: p.initial, netReturn: (p.meanReturn - p.ter).toFixed(1), volatility: p.volatility })),
      };
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.analysis) aiResult = data.analysis;
      else aiError = data.message || "L'analyse n'a pas pu être générée.";
    } catch (e) {
      aiError = "Impossible de contacter le serveur d'analyse.";
    } finally {
      aiLoading = false;
    }
  }
</script>

{#if ready && a}
  <!-- Score patrimoine -->
  <section class="panel score-panel">
    <div class="score-block">
      <span class="k">Score patrimoine</span>
      <div class="score-big"><span class="num">{a.note}</span><span class="score-max">/10</span></div>
      <div class="score-bar"><div class="score-fill" style="width:{a.score}%"></div></div>
      <p class="percentile">Tu fais mieux que <strong>{a.percentile} %</strong> des investisseurs.</p>
    </div>
    <div class="score-meta">
      <div class="meta">
        <span class="k">Diversification</span>
        <span class="v">{a.diversif}</span>
      </div>
      <div class="meta">
        <span class="k">Niveau de risque</span>
        <span class="v" style="color:{a.risk === 'Faible' ? 'var(--green)' : a.risk === 'Élevé' ? 'var(--red)' : 'var(--gold)'}">{a.risk}</span>
      </div>
      <div class="meta">
        <span class="k">Actifs</span>
        <span class="v">{a.allocs.length}</span>
      </div>
      <div class="meta">
        <span class="k">Volatilité moyenne</span>
        <span class="v num">{a.weightedVol.toFixed(0)} %</span>
      </div>
    </div>
  </section>

  <!-- Allocation -->
  <section class="panel">
    <div class="panel-head"><h2>Allocation</h2></div>
    <div class="alloc-wrap">
      <div class="donut-box">
        <svg class="donut" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r={DONUT_R} fill="none" stroke="rgba(255,255,255,.05)" stroke-width="11" />
          {#each segs as s}
            <circle cx="55" cy="55" r={DONUT_R} fill="none" stroke={s.color} stroke-width="11" stroke-dasharray="{s.len} {DONUT_C}" stroke-dashoffset={s.offset} transform="rotate(-90 55 55)" />
          {/each}
        </svg>
        <div class="donut-center"><span class="dc-num num">{a.allocs.length}</span><span class="dc-lbl">actifs</span></div>
      </div>
      <div class="alloc-list">
        {#each a.allocs as it}
          <div class="alloc-row">
            <span class="alloc-name"><i class="adot" style="background:{it.color}"></i>{it.name}</span>
            <div class="alloc-track"><div class="alloc-fill" style="width:{it.alloc}%;background:{it.color}"></div></div>
            <span class="alloc-pct num">{it.alloc.toFixed(0)} %</span>
            <span class="alloc-val num">{fmtNum(it.value)} FCFP</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- Rapport IA -->
  <section class="panel">
    <div class="panel-head">
      <h2>Rapport détaillé</h2>
      <button class="btn primary" on:click={analyze} disabled={aiLoading || a.allocs.length === 0}>{aiLoading ? 'Analyse…' : 'Générer le rapport'}</button>
    </div>
    {#if aiLoading}
      <div class="ai-loading"><span class="spinner"></span> Claude Haiku rédige ton rapport patrimonial…</div>
    {:else if aiError}
      <p class="ai-error">{aiError} {#if aiError.includes('cle') || aiError.includes('clé')}<a class="inline-link" href="/parametres">Configurer la clé</a>{/if}</p>
    {:else if aiResult}
      <div class="ai-result">{@html mdToHtml(aiResult)}</div>
    {:else}
      <p class="muted-text">Génère une analyse pédagogique et personnalisée de ta stratégie par Claude Haiku 4.5 — diversification, risque, horizon, inflation.</p>
    {/if}
  </section>
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<style>
  .score-panel { display: grid; grid-template-columns: 1fr 1px 1.2fr; gap: 2.5rem; align-items: center; margin-bottom: 1.1rem; }
  .score-panel::before { content: ''; grid-column: 2; align-self: stretch; background: var(--line); }
  .k { display: block; font-size: .82rem; color: var(--muted); margin-bottom: .6rem; }
  .score-big { display: flex; align-items: baseline; gap: .3rem; }
  .score-big .num { font-size: clamp(3rem, 7vw, 4.5rem); font-weight: 700; letter-spacing: -.04em; line-height: 1; color: var(--accent); }
  .score-max { font-size: 1.3rem; color: var(--muted); }
  .score-bar { height: 5px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin: 1.2rem 0 1rem; max-width: 280px; }
  .score-fill { height: 100%; background: var(--accent); border-radius: 999px; }
  .percentile { font-size: .92rem; color: var(--muted); margin: 0; }
  .percentile strong { color: var(--accent); font-weight: 600; }

  .score-meta { grid-column: 3; display: grid; grid-template-columns: 1fr 1fr; gap: 1.6rem 2rem; }
  .meta { display: flex; flex-direction: column; }
  .meta .v { font-size: 1.5rem; font-weight: 600; letter-spacing: -.02em; }

  .alloc-wrap { display: grid; grid-template-columns: 180px 1fr; gap: 2.6rem; align-items: center; }
  .donut-box { position: relative; width: 170px; height: 170px; }
  .donut { width: 170px; height: 170px; display: block; }
  .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .dc-num { font-size: 1.9rem; font-weight: 700; letter-spacing: -.02em; }
  .dc-lbl { font-size: .76rem; color: var(--muted); }
  .alloc-list { display: flex; flex-direction: column; gap: 1.1rem; }
  .alloc-row { display: grid; grid-template-columns: 1.4fr 2fr auto auto; gap: 1.2rem; align-items: center; }
  .alloc-name { font-weight: 500; font-size: .92rem; display: inline-flex; align-items: center; }
  .adot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: .55rem; }
  .alloc-track { height: 6px; border-radius: 999px; background: rgba(255,255,255,.07); overflow: hidden; }
  .alloc-fill { height: 100%; background: rgba(255,255,255,.5); border-radius: 999px; }
  .alloc-pct { font-size: .9rem; font-weight: 600; min-width: 44px; text-align: right; }
  .alloc-val { font-size: .85rem; color: var(--muted); min-width: 130px; text-align: right; }

  .ai-loading { display: flex; align-items: center; gap: .6rem; color: var(--muted); font-size: .9rem; }
  .spinner { width: 15px; height: 15px; border: 2px solid rgba(255,255,255,.2); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ai-error { color: var(--muted); font-size: .9rem; margin: 0; }
  .ai-result { font-size: .94rem; line-height: 1.75; color: #c8c8c8; }
  .ai-result :global(strong) { color: var(--ink); font-weight: 600; }
  .ai-result :global(ul) { margin: .5rem 0; padding-left: 1.1rem; }
  .ai-result :global(li) { margin: .3rem 0; }

  @media (max-width: 760px) {
    .score-panel { grid-template-columns: 1fr; gap: 1.6rem; }
    .score-panel::before { display: none; }
    .score-meta { grid-column: 1; }
    .alloc-wrap { grid-template-columns: 1fr; justify-items: center; gap: 1.8rem; }
    .alloc-list { width: 100%; }
    .alloc-row { grid-template-columns: 1fr auto; }
    .alloc-track, .alloc-val { display: none; }
  }
</style>

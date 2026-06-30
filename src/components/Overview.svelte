<script>
  import { onMount, tick } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { loadState, saveState, CURRENT_YEAR } from '../lib/store.js';
  import { getPreset } from '../lib/presets.js';
  import {
    projectPortfolio,
    monteCarlo,
    monthsToGoal,
    wealthScore,
    milestoneLadder,
  } from '../lib/finance.js';

  const grouped = new Intl.NumberFormat('fr-FR');
  const fmtNum = (v) => grouped.format(Math.round(v || 0));
  const msLabel = (v) => (v >= 1e9 ? v / 1e9 + ' Md' : v / 1e6 + ' M');

  let state = null;
  let ready = false;

  onMount(() => {
    state = loadState();
    ready = true;
    renderChart();
    return () => chart && chart.destroy();
  });
  $: if (ready && state) saveState(state);

  $: years = ready ? state.targetYear - CURRENT_YEAR : 0;
  $: clean = ready
    ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, volatility: +p.volatility || 0, ter: +p.ter || 0 }))
    : [];
  $: totalMonthly = clean.reduce((s, p) => s + p.monthly, 0);
  $: savingsRate = ready && state.salary > 0 ? (totalMonthly / state.salary) * 100 : 0;

  $: result = ready ? projectPortfolio(clean, CURRENT_YEAR, state.targetYear, state.stepUp || 0) : null;
  $: mc = ready && state.mcMode ? monteCarlo(clean, CURRENT_YEAR, state.targetYear, state.settings.mcRuns, state.stepUp || 0) : null;

  $: factor = ready && state.showReal ? 1 / Math.pow(1 + state.inflation / 100, years) : 1;
  $: adj = (v) => v * factor;

  $: months = result ? result.months : 0;
  $: investedFinal = result ? result.invested[months] || 0 : 0;
  $: lowSeries = state && state.mcMode && mc ? mc.p10 : result ? result.totals.pessimistic : [];
  $: midSeries = state && state.mcMode && mc ? mc.p50 : result ? result.totals.realistic : [];
  $: highSeries = state && state.mcMode && mc ? mc.p90 : result ? result.totals.optimistic : [];

  $: finalMid = adj(midSeries[months] || 0);
  $: gainMid = finalMid - adj(investedFinal);

  // Compteur anime du chiffre principal
  const heroNum = tweened(0, { duration: 900, easing: cubicOut });
  $: if (ready) heroNum.set(finalMid);

  $: milestones = ready ? milestoneLadder(finalMid) : [];

  $: progress = ready && state.goal > 0 ? Math.min(100, (midSeries[months] / state.goal) * 100) : 0;
  $: toGoal = ready && state.goal > 0 ? monthsToGoal(clean, state.goal, state.stepUp || 0) : 0;
  function durationLabel(m) {
    if (m === 0) return 'Objectif atteint';
    if (m === null) return 'Hors de portée à ce rythme';
    const y = Math.floor(m / 12), mo = m % 12;
    if (y === 0) return `Encore ${m} mois`;
    if (mo === 0) return `Encore ${y} an${y > 1 ? 's' : ''}`;
    return `Encore ${y} an${y > 1 ? 's' : ''} et ${mo} mois`;
  }

  $: score = ready ? wealthScore({ savingsRate, placements: clean, years }) : 0;
  $: gainPct = investedFinal > 0 ? (gainMid / adj(investedFinal)) * 100 : 0;
  $: percentile = Math.min(95, Math.round(28 + score * 0.62));
  $: nextMs = milestones.find((m) => !m.reached);
  $: nextEta = nextMs ? monthsToGoal(clean, nextMs.value, state.stepUp || 0) : null;
  function shortDur(m) {
    if (m === 0 || m === null) return '';
    const y = Math.floor(m / 12), mo = m % 12;
    if (y === 0) return `dans ${m} mois`;
    if (mo === 0) return `dans ${y} an${y > 1 ? 's' : ''}`;
    return `dans ${y} an${y > 1 ? 's' : ''} et ${mo} mois`;
  }

  $: totalFinal = result ? result.perPlacement.reduce((s, r) => s + r.final.realistic, 0) || 1 : 1;
  $: assets = result
    ? result.perPlacement
        .map((r) => ({ name: r.placement.name, color: getPreset(r.placement.presetId).color, alloc: (r.final.realistic / totalFinal) * 100, value: adj(r.final.realistic), net: r.placement.meanReturn - r.placement.ter, spark: r.spark }))
        .sort((a, b) => b.value - a.value)
    : [];

  function sparkPoints(arr, w = 110, h = 30) {
    if (!arr || arr.length < 2) return '';
    const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1;
    return arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
  }
  function sparkArea(arr, w = 110, h = 30) {
    const pts = sparkPoints(arr, w, h);
    return pts ? `0,${h} ${pts} ${w},${h}` : '';
  }

  // ---- Chart ----
  let canvas, chart;
  async function renderChart() {
    if (!canvas || !result) return;
    const { default: Chart } = await import('chart.js/auto');
    const labels = [];
    for (let m = 0; m <= months; m++) labels.push(CURRENT_YEAR + Math.floor(m / 12) + (m % 12) / 12);

    const glow = {
      id: 'glow',
      beforeDatasetDraw(c, args) { if (args.index === 3) { c.ctx.save(); c.ctx.shadowColor = 'rgba(255,255,255,0.4)'; c.ctx.shadowBlur = 14; } },
      afterDatasetDraw(c, args) { if (args.index === 3) c.ctx.restore(); },
    };
    const msPlugin = {
      id: 'msLines',
      afterDatasetsDraw(c) {
        const { ctx, chartArea, scales } = c;
        const yMax = scales.y.max;
        const cand = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9];
        const picks = cand.filter((v) => v <= yMax * 0.96 && v >= yMax * 0.16);
        const finalReal = midSeries[months] * factor;
        ctx.save();
        for (const v of picks) {
          const y = scales.y.getPixelForValue(v);
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 1;
          ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
          ctx.fillStyle = v <= finalReal ? 'rgba(201,168,93,0.9)' : 'rgba(255,255,255,0.3)';
          ctx.font = '500 11px "Inter Tight", sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(msLabel(v), chartArea.right - 6, y - 5);
        }
        ctx.restore();
      },
    };

    const cx = canvas.getContext('2d');
    const grad = cx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, 'rgba(255,255,255,0.13)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');

    const mk = (arr, color, width, fill, dash) => ({ data: arr.map((v) => adj(v)), borderColor: color, backgroundColor: fill ? grad : 'transparent', borderWidth: width, borderDash: dash || [], pointRadius: 0, tension: 0.35, fill: fill ? 'origin' : false });
    const data = { labels, datasets: [
      mk(result.invested, 'rgba(255,255,255,0.16)', 1.2, false, [2, 4]),
      mk(lowSeries, '#b76b6b', 2, false),
      mk(highSeries, '#5e9f73', 2, false),
      mk(midSeries, '#ffffff', 4, true),
    ] };
    const opts = {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      animation: { duration: 1100, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f0f10', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 12, displayColors: false, titleColor: '#8a8a8a', bodyColor: '#fff',
          callbacks: { title: (i) => `Année ${Math.floor(i[0].parsed.x)}`, label: (item) => { const names = ['Capital investi', 'Pessimiste', 'Optimiste', state.mcMode ? 'Médiane' : 'Réaliste']; return `${names[item.datasetIndex]} : ${fmtNum(item.parsed.y)} FCFP`; } } },
      },
      scales: {
        x: { type: 'linear', min: CURRENT_YEAR, max: state.targetYear, grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', stepSize: Math.max(1, Math.round(years / 8)), callback: (v) => Math.round(v), font: { size: 11 } } },
        y: { display: false, min: 0, grace: '6%' },
      },
    };
    if (chart) { chart.data = data; chart.options = opts; chart.update('none'); }
    else chart = new Chart(canvas, { type: 'line', data, options: opts, plugins: [glow, msPlugin] });
  }
  $: if (ready && canvas && (result || mc || (state && state.showReal) || (state && state.mcMode))) tick().then(renderChart);
</script>

{#if ready}
  <section class="hero">
    <div class="hero-main">
      <p class="hero-eyebrow">Patrimoine futur · {state.targetYear}</p>
      <div class="hero-amount"><span class="num">{fmtNum($heroNum)}</span><span class="cur">FCFP</span></div>
      <p class="hero-growth"><span class="num">+{fmtNum(gainMid)}</span> FCFP de croissance estimée <span class="growth-badge">+{gainPct.toFixed(1)} %</span></p>

      <div class="journey">
        {#each milestones as m, i}
          <div class="ms-node" class:reached={m.reached}>
            <span class="ms-dot">{#if m.reached}✓{/if}</span>
            <span class="ms-label">{msLabel(m.value)}</span>
          </div>
          {#if i < milestones.length - 1}
            <span class="ms-line" class:reached={milestones[i + 1].reached}></span>
          {/if}
        {/each}
      </div>
      {#if nextMs && nextEta}
        <p class="next-ms">Prochain jalon : <strong>{msLabel(nextMs.value)}</strong> {shortDur(nextEta)}</p>
      {/if}

      <div class="hero-score">
        <div class="score-head"><span class="score-label">Indice patrimoine · <span class="top-pct">Top {100 - percentile} %</span></span><span class="score-val"><span class="num">{score}</span><span class="score-max">/100</span></span></div>
        <div class="score-bar"><div class="score-fill" style="width:{score}%"></div></div>
      </div>
    </div>

    <div class="hero-goal">
      <span class="goal-label">Objectif patrimoine</span>
      <div class="goal-input">
        <input type="number" min="0" step="500000" bind:value={state.goal} placeholder="0" />
        <span class="goal-cur">FCFP</span>
      </div>
      {#if state.goal > 0}
        <div class="goal-pct num">{progress.toFixed(0)} %</div>
        <div class="goal-bar"><div class="goal-fill" style="width:{progress}%"></div></div>
        <div class="goal-eta">{durationLabel(toGoal)}</div>
        <a class="goal-link" href="/objectifs">Voir mes objectifs →</a>
      {:else}
        <p class="muted-text" style="margin:.7rem 0 0;font-size:.84rem">Fixe un montant cible pour suivre ta progression.</p>
      {/if}
    </div>
  </section>

  <div class="mini-row">
    <div class="mini"><span class="mini-label">Capital investi</span><span class="mini-val num">{fmtNum(adj(investedFinal))}</span><span class="mini-cur">FCFP</span></div>
    <div class="mini"><span class="mini-label">Épargne mensuelle</span><span class="mini-val num">{fmtNum(totalMonthly)}</span><span class="mini-cur">FCFP</span></div>
    <div class="mini"><span class="mini-label">Taux d'épargne</span><span class="mini-val"><span class="num">{savingsRate.toFixed(0)}</span> %</span><span class="mini-cur">de ton revenu</span></div>
    <div class="mini"><span class="mini-label">Horizon</span><span class="mini-val num">{state.targetYear}</span><span class="mini-cur">dans {years} ans</span></div>
  </div>

  <section class="panel chart-panel">
    <div class="panel-head">
      <div class="legend">
        <span class="lg"><i class="dot d-mid"></i>{state.mcMode ? 'Médiane' : 'Réaliste'}</span>
        <span class="lg"><i class="dot d-high"></i>{state.mcMode ? 'p90' : 'Optimiste'}</span>
        <span class="lg"><i class="dot d-low"></i>{state.mcMode ? 'p10' : 'Pessimiste'}</span>
      </div>
      <div class="quick">
        <label class="toggle"><input type="checkbox" bind:checked={state.showReal} /><span class="track"><span class="knob"></span></span><span class="toggle-label">Inflation</span></label>
        <label class="toggle"><input type="checkbox" bind:checked={state.mcMode} /><span class="track"><span class="knob"></span></span><span class="toggle-label">Monte-Carlo</span></label>
      </div>
    </div>
    <div class="chart-wrap"><canvas bind:this={canvas}></canvas></div>
  </section>

  <div class="rep-head">
    <div class="section-title">Répartition</div>
    <a class="section-link" href="/portefeuille">Gérer →</a>
  </div>
  <div class="assets">
    {#each assets as a}
      <div class="asset" style="border-left:2px solid {a.color}">
        <div class="asset-top">
          <span class="asset-name"><i class="adot" style="background:{a.color}"></i>{a.name}</span>
          <span class="asset-alloc num">{a.alloc.toFixed(0)} %</span>
        </div>
        <div class="alloc-bar"><div class="alloc-fill" style="width:{a.alloc}%;background:{a.color}"></div></div>
        <div class="asset-value num">{fmtNum(a.value)} <span class="asset-cur">FCFP</span></div>
        <svg class="spark" viewBox="0 0 110 30" preserveAspectRatio="none">
          <polygon points={sparkArea(a.spark)} fill={a.color} opacity="0.09" />
          <polyline points={sparkPoints(a.spark)} fill="none" stroke={a.color} stroke-width="1.75" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="asset-net"><span class="badge pos">↗ +{a.net.toFixed(1)} %/an</span></div>
      </div>
    {/each}
    {#if assets.length === 0}
      <p class="muted-text">Aucun actif. <a class="inline-link" href="/portefeuille">Ajoute un placement</a>.</p>
    {/if}
  </div>
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<style>
  .hero { display: grid; grid-template-columns: 1.6fr 1fr; background: var(--card); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; margin-bottom: 1.1rem; }
  .hero-main { padding: 2.6rem 2.8rem; }
  .hero-eyebrow { color: var(--muted); margin: 0 0 1.2rem; font-size: .9rem; }
  .hero-amount { display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap; }
  .hero-amount .num { font-size: clamp(3.2rem, 8.5vw, 6rem); font-weight: 700; letter-spacing: -.045em; line-height: .92; }
  .hero-amount .cur { font-size: 1.15rem; color: var(--ink); opacity: .38; font-weight: 500; }
  .hero-growth { color: var(--muted); margin: 1.1rem 0 0; font-size: 1rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .hero-growth .num { color: var(--ink); font-weight: 500; }
  .growth-badge { font-size: .8rem; font-weight: 600; color: var(--accent); background: rgba(201,168,93,.12); padding: .2rem .55rem; border-radius: 999px; }
  .next-ms { margin: 1.4rem 0 0; font-size: .85rem; color: var(--muted); }
  .next-ms strong { color: var(--accent); font-weight: 600; }
  .top-pct { color: var(--accent); }

  .journey { display: flex; align-items: center; margin: 2.2rem 0 0; }
  .ms-node { display: flex; flex-direction: column; align-items: center; gap: .5rem; flex-shrink: 0; }
  .ms-dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; font-size: .62rem; color: #050505; transition: all .2s; }
  .ms-node.reached .ms-dot { background: var(--accent); border-color: var(--accent); }
  .ms-label { font-size: .76rem; color: var(--muted); }
  .ms-node.reached .ms-label { color: var(--accent); }
  .ms-line { flex: 1; height: 1.5px; background: rgba(255,255,255,.1); margin: 0 .3rem 1.55rem; }
  .ms-line.reached { background: var(--accent); opacity: .5; }

  .hero-score { margin-top: 2.2rem; max-width: 340px; }
  .score-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .6rem; }
  .score-label { font-size: .84rem; color: var(--muted); }
  .score-val .num { font-weight: 600; font-size: .98rem; }
  .score-max { color: var(--muted); font-size: .8rem; }
  .score-bar { height: 4px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
  .score-fill { height: 100%; background: var(--accent); border-radius: 999px; }

  .hero-goal { padding: 2.6rem 2.4rem; border-left: 1px solid var(--line); display: flex; flex-direction: column; justify-content: center; }
  .goal-label { font-size: .84rem; color: var(--muted); margin-bottom: .6rem; }
  .goal-input { display: flex; align-items: baseline; gap: .4rem; border-bottom: 1px solid var(--line); padding-bottom: .55rem; }
  .goal-input input { background: transparent; border: none; outline: none; color: var(--ink); font-size: 1.6rem; font-weight: 600; font-family: inherit; width: 100%; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .goal-cur { color: var(--muted); font-size: .85rem; }
  .goal-pct { font-size: 1.5rem; font-weight: 700; margin: 1.1rem 0 .6rem; letter-spacing: -.02em; }
  .goal-bar { height: 5px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin-bottom: .7rem; }
  .goal-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .3s; }
  .goal-eta { font-size: .84rem; color: var(--muted); }
  .goal-link { font-size: .82rem; color: var(--muted); text-decoration: none; margin-top: 1rem; transition: color .15s; }
  .goal-link:hover { color: var(--ink); }

  .mini-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; margin-bottom: 2.4rem; }
  .mini { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 1.4rem 1.5rem; }
  .mini-label { display: block; font-size: .82rem; color: var(--muted); margin-bottom: .7rem; }
  .mini-val { font-size: 1.75rem; font-weight: 600; letter-spacing: -.025em; display: block; }
  .mini-cur { font-size: .78rem; color: var(--muted); display: block; margin-top: .3rem; }

  .chart-panel { margin-bottom: 2.6rem; }
  .legend { display: flex; gap: 1.3rem; }
  .lg { font-size: .82rem; color: var(--muted); display: inline-flex; align-items: center; gap: .45rem; }
  .dot { width: 16px; height: 2px; border-radius: 2px; display: inline-block; }
  .d-mid { background: #fff; height: 3px; }
  .d-high { background: var(--green); }
  .d-low { background: var(--red); }
  .quick { display: flex; gap: 1.2rem; }
  .chart-wrap { height: 360px; }

  .rep-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; }
  .section-title { font-size: 1rem; font-weight: 600; letter-spacing: -.01em; }
  .section-link { font-size: .84rem; color: var(--muted); text-decoration: none; transition: color .15s; }
  .section-link:hover { color: var(--ink); }
  .assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.1rem; }
  .asset { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 1.4rem; }
  .asset-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: .7rem; }
  .asset-name { font-weight: 600; font-size: .95rem; display: inline-flex; align-items: center; }
  .adot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: .5rem; }
  .asset-alloc { font-size: .85rem; color: var(--muted); }
  .alloc-bar { height: 3px; border-radius: 999px; background: rgba(255,255,255,.07); overflow: hidden; margin-bottom: 1.1rem; }
  .alloc-fill { height: 100%; background: rgba(255,255,255,.55); border-radius: 999px; }
  .asset-value { font-size: 1.35rem; font-weight: 600; letter-spacing: -.02em; }
  .asset-cur { font-size: .76rem; color: var(--muted); font-weight: 400; }
  .spark { width: 100%; height: 34px; margin: 1rem 0 .7rem; display: block; }
  .asset-net { font-size: .82rem; }

  @media (max-width: 820px) {
    .hero { grid-template-columns: 1fr; }
    .hero-goal { border-left: none; border-top: 1px solid var(--line); }
    .mini-row { grid-template-columns: 1fr 1fr; }
  }
</style>

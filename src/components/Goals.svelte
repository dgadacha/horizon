<script>
  import { onMount } from 'svelte';
  import { loadState, saveState, CURRENT_YEAR } from '../lib/store.js';
  import { projectPortfolio, monteCarlo, monthsToGoal, solveGoal, probReachGoal, milestoneLadder } from '../lib/finance.js';

  const grouped = new Intl.NumberFormat('fr-FR');
  const fmtNum = (v) => grouped.format(Math.round(v || 0));
  const msLabel = (v) => (v >= 1e9 ? v / 1e9 + ' Md' : v / 1e6 + ' M');

  const SWR = 0.04; // taux de retrait sûr annuel (règle des 4 %)

  let state = null;
  let ready = false;

  onMount(() => {
    state = loadState();
    // Compat : si un objectif capital existe sans revenu passif défini, on le déduit.
    if (!state.passiveTarget && state.goal > 0) state.passiveTarget = Math.round((state.goal * SWR) / 12);
    ready = true;
  });
  // L'objectif capital est piloté par le revenu passif visé (capital = revenu × 12 / 4 %).
  $: if (ready) state.goal = Math.round(((+state.passiveTarget || 0) * 12) / SWR);
  $: if (ready && state) saveState(state);

  $: horizonYears = ready ? Math.max(1, state.targetYear - CURRENT_YEAR) : 1;
  function setHorizon(v) {
    const y = Math.max(1, Math.min(60, Math.round(+v || 0)));
    state.targetYear = CURRENT_YEAR + y;
  }

  $: years = ready ? state.targetYear - CURRENT_YEAR : 0;
  $: clean = ready
    ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, volatility: +p.volatility || 0, ter: +p.ter || 0 }))
    : [];
  $: totalMonthly = clean.reduce((s, p) => s + p.monthly, 0);
  $: result = ready ? projectPortfolio(clean, CURRENT_YEAR, state.targetYear, state.stepUp || 0) : null;
  $: months = result ? result.months : 0;
  $: projected = result ? result.totals.realistic[months] || 0 : 0;

  $: progress = ready && state.goal > 0 ? Math.min(100, (projected / state.goal) * 100) : 0;
  $: toGoal = ready && state.goal > 0 ? monthsToGoal(clean, state.goal, state.stepUp || 0) : 0;
  $: required = ready && state.goal > 0 ? solveGoal(clean, CURRENT_YEAR, state.targetYear, state.goal, state.stepUp || 0) : null;
  $: gap = required !== null ? required - totalMonthly : null;
  $: mc = ready && state.goal > 0 ? monteCarlo(clean, CURRENT_YEAR, state.targetYear, state.settings.mcRuns, state.stepUp || 0) : null;
  $: prob = mc ? probReachGoal(mc.finals, state.goal) : null;
  $: milestones = ready ? milestoneLadder(Math.max(projected, state.goal || 0)) : [];
  $: reste = ready && state.goal > 0 ? Math.max(0, state.goal - projected) : 0;
  $: passiveMonthly = projected * SWR / 12; // règle des 4 % (retrait sûr)
  $: liberte = ready && state.salary > 0 ? Math.min(100, (passiveMonthly / state.salary) * 100) : 0;

  // Durée réaliste pour atteindre l'objectif au rythme d'épargne actuel.
  $: realMonths = ready && state.goal > 0 ? monthsToGoal(clean, state.goal, state.stepUp || 0) : 0;
  $: chosenMonths = horizonYears * 12;
  $: realYears = realMonths ? Math.ceil(realMonths / 12) : 0;
  // « En retard » : objectif hors de portée dans l'horizon choisi au rythme actuel.
  $: behind = ready && state.goal > 0 && totalMonthly > 0 && (realMonths === null || realMonths > chosenMonths + 2);
  function adoptRealDuration() {
    if (realMonths && realMonths !== null) state.targetYear = CURRENT_YEAR + Math.ceil(realMonths / 12);
  }

  function durationLabel(m) {
    if (m === 0) return 'déjà atteint';
    if (m === null) return 'hors de portée à ce rythme';
    const y = Math.floor(m / 12), mo = m % 12;
    if (y === 0) return `${m} mois`;
    if (mo === 0) return `${y} an${y > 1 ? 's' : ''}`;
    return `${y} an${y > 1 ? 's' : ''} et ${mo} mois`;
  }
</script>

{#if ready}
  <section class="panel goal-hero">
    <div class="gh-left">
      <span class="k">Combien veux-tu toucher chaque mois grâce à tes placements ?</span>
      <div class="gh-input">
        <input type="number" min="0" step="50000" bind:value={state.passiveTarget} placeholder="0" />
        <span class="cur">FCFP/mois</span>
      </div>
      <div class="gh-horizon">
        <span class="muted">au bout de</span>
        <input class="yr" type="number" min="1" max="60" value={horizonYears} on:input={(e) => setHorizon(e.target.value)} />
        <span class="muted">ans</span>
        {#if state.goal > 0}<span class="gh-cap">soit <strong>{fmtNum(state.goal)} FCFP</strong> de capital (règle des 4 %)</span>{/if}
      </div>
      {#if state.goal > 0}
        <div class="gh-bar"><div class="gh-fill" style="width:{progress}%"></div></div>
        <div class="gh-stat"><span class="num pct">{progress.toFixed(0)} %</span><span class="muted">de l'objectif atteint</span></div>
      {:else}
        <p class="muted-text" style="margin-top:1rem">Indique le revenu mensuel visé — on en déduit le capital cible et l'effort nécessaire.</p>
      {/if}
    </div>
    {#if state.goal > 0}
      <div class="gh-right">
        <div class="big-stat">
          <span class="k">Échéance estimée</span>
          <span class="v">{durationLabel(toGoal)}</span>
        </div>
        {#if prob !== null}
          <div class="big-stat">
            <span class="k">Probabilité (Monte-Carlo)</span>
            <span class="v num">{prob.toFixed(0)} %</span>
          </div>
        {/if}
      </div>
    {/if}
  </section>

  {#if behind}
    <section class="panel adjust">
      <div class="adj-text">
        <span class="k" style="margin:0 0 .35rem">Horizon trop court pour ce revenu</span>
        <p>
          À ton rythme actuel (<strong>{fmtNum(totalMonthly)} FCFP/mois</strong>),
          {#if realMonths === null}
            ce revenu n'est pas atteignable — augmente ton épargne ou vise un montant plus modeste.
          {:else}
            ce revenu serait atteint dans <strong>{realYears} ans</strong> plutôt qu'en {horizonYears} ans.
          {/if}
        </p>
      </div>
      {#if realMonths !== null}
        <button class="btn" on:click={adoptRealDuration}>Caler l'échéance sur {realYears} ans</button>
      {/if}
    </section>
  {/if}

  {#if state.goal > 0}
    <!-- Effort -->
    <div class="stats-row">
      <div class="panel stat">
        <span class="k">Reste à atteindre</span>
        <span class="v"><span class="num">{reste === 0 ? '✓' : fmtNum(reste)}</span> {#if reste !== 0}<span class="unit">FCFP</span>{/if}</span>
      </div>
      <div class="panel stat">
        <span class="k">Épargne actuelle</span>
        <span class="v"><span class="num">{fmtNum(totalMonthly)}</span> <span class="unit">FCFP/mois</span></span>
      </div>
      <div class="panel stat">
        <span class="k">Épargne nécessaire</span>
        <span class="v"><span class="num">{required === 0 ? '—' : fmtNum(required)}</span> <span class="unit">FCFP/mois</span></span>
      </div>
      <div class="panel stat">
        <span class="k">{gap > 0 ? 'À ajouter / mois' : 'Marge mensuelle'}</span>
        <span class="v" class:pos={gap <= 0}><span class="num">{required === 0 ? '✓' : fmtNum(Math.abs(gap))}</span> {#if required !== 0}<span class="unit">FCFP/mois</span>{/if}</span>
      </div>
    </div>
  {/if}

  <!-- Liberté financière -->
  <section class="panel liberte">
    <div class="lib-left">
      <span class="k">Revenu passif projeté</span>
      <div class="lib-amount"><span class="num">{fmtNum(passiveMonthly)}</span> <span class="unit">FCFP/mois</span></div>
      <p class="muted-text" style="margin:.7rem 0 0">En retirant 4 %/an de ton patrimoine projeté de {fmtNum(projected)} FCFP (règle des 4 %, indicative).</p>
    </div>
    <div class="lib-right">
      <div class="lib-head"><span class="k" style="margin:0">Liberté financière</span><span class="lib-pct num">{liberte.toFixed(0)} %</span></div>
      <div class="lib-bar"><div class="lib-fill" style="width:{liberte}%"></div></div>
      <p class="muted-text" style="margin:.8rem 0 0">
        {#if liberte >= 100}Tes revenus passifs couvriraient l'équivalent de ton salaire actuel. 🎉
        {:else}≈ {liberte.toFixed(0)} % de ton salaire actuel ({fmtNum(state.salary)} FCFP/mois) remplacé par tes revenus passifs.{/if}
      </p>
    </div>
  </section>

  <!-- Parcours -->
  <section class="panel">
    <div class="panel-head"><h2>Ton parcours patrimonial</h2></div>
    <div class="journey">
      {#each milestones as m, i}
        <div class="ms-node" class:reached={projected >= m.value} class:target={state.goal >= m.value && projected < m.value}>
          <span class="ms-dot">{#if projected >= m.value}✓{/if}</span>
          <span class="ms-label">{msLabel(m.value)}</span>
        </div>
        {#if i < milestones.length - 1}<span class="ms-line" class:reached={projected >= milestones[i + 1].value}></span>{/if}
      {/each}
    </div>
    <p class="journey-note">
      {#if state.goal === 0}
        Tu projettes <strong>{fmtNum(projected)} FCFP</strong> en {state.targetYear}. Fixe un objectif ci-dessus pour suivre ta progression vers chaque jalon.
      {:else if required === 0}
        Ton capital de départ suffit déjà à atteindre {fmtNum(state.goal)} FCFP.
      {:else if gap > 0}
        En épargnant <strong>{fmtNum(required)} FCFP/mois</strong>, tu atteins ton objectif en {state.targetYear}. Soit {fmtNum(gap)} FCFP/mois de plus qu'aujourd'hui.
      {:else}
        Au rythme actuel, tu atteins {fmtNum(state.goal)} FCFP dans <strong>{durationLabel(toGoal)}</strong> — avec {fmtNum(-gap)} FCFP/mois de marge.
      {/if}
    </p>
  </section>
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<style>
  .k { display: block; font-size: .82rem; color: var(--muted); margin-bottom: .6rem; }
  .goal-hero { display: grid; grid-template-columns: 1.5fr 1fr; gap: 2.5rem; margin-bottom: 1.1rem; align-items: center; }
  .gh-input { display: flex; align-items: baseline; gap: .5rem; border-bottom: 1px solid var(--line); padding-bottom: .6rem; max-width: 360px; }
  .gh-input input { background: transparent; border: none; outline: none; color: var(--ink); font-size: clamp(2rem, 5vw, 3rem); font-weight: 700; font-family: inherit; width: 100%; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .gh-input .cur { color: var(--muted); font-size: 1rem; }
  .gh-horizon { display: flex; align-items: baseline; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; font-size: .9rem; }
  .gh-horizon .muted { color: var(--muted); }
  .gh-horizon .yr { width: 3.2rem; background: transparent; border: none; border-bottom: 1px solid var(--line); outline: none; color: var(--ink); font-family: inherit; font-size: 1.1rem; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums; padding-bottom: .15rem; }
  .gh-horizon .yr:focus { border-bottom-color: var(--accent); }
  .gh-cap { color: var(--muted); margin-left: .3rem; }
  .gh-cap strong { color: var(--ink); font-weight: 600; }

  .adjust { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; margin-bottom: 1.1rem; border-color: rgba(201,168,93,.28); }
  .adjust .adj-text p { margin: 0; font-size: .92rem; color: var(--muted); line-height: 1.55; }
  .adjust .adj-text strong { color: var(--ink); font-weight: 600; }
  .adjust .btn { flex-shrink: 0; }
  .gh-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin: 1.4rem 0 .8rem; }
  .gh-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .3s; }
  .gh-stat { display: flex; align-items: baseline; gap: .6rem; }
  .gh-stat .pct { font-size: 1.6rem; font-weight: 700; color: var(--accent); letter-spacing: -.02em; }
  .gh-stat .muted { color: var(--muted); font-size: .88rem; }
  .gh-right { display: flex; flex-direction: column; gap: 1.6rem; padding-left: 2.5rem; border-left: 1px solid var(--line); }
  .big-stat { display: flex; flex-direction: column; }
  .big-stat .v { font-size: 1.6rem; font-weight: 600; letter-spacing: -.02em; }

  .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.1rem; margin-bottom: 1.1rem; }
  .stat .v { font-size: 1.5rem; font-weight: 600; letter-spacing: -.025em; }
  .stat .v.pos { color: var(--green); }
  .stat .unit { font-size: .78rem; color: var(--muted); font-weight: 400; }

  .liberte { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; margin-bottom: 1.1rem; align-items: center; }
  .lib-amount { display: flex; align-items: baseline; gap: .4rem; }
  .lib-amount .num { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 700; letter-spacing: -.03em; color: var(--accent); }
  .lib-amount .unit { font-size: .9rem; color: var(--muted); }
  .lib-right { padding-left: 2.5rem; border-left: 1px solid var(--line); }
  .lib-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: .7rem; }
  .lib-pct { font-size: 1.5rem; font-weight: 700; color: var(--accent); letter-spacing: -.02em; }
  .lib-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
  .lib-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .3s; }

  .journey { display: flex; align-items: center; margin-bottom: 1.4rem; }
  .ms-node { display: flex; flex-direction: column; align-items: center; gap: .55rem; flex-shrink: 0; }
  .ms-dot { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; font-size: .68rem; color: #050505; }
  .ms-node.reached .ms-dot { background: var(--accent); border-color: var(--accent); }
  .ms-node.target .ms-dot { border-color: var(--accent); }
  .ms-label { font-size: .8rem; color: var(--muted); }
  .ms-node.reached .ms-label { color: var(--accent); }
  .ms-line { flex: 1; height: 1.5px; background: rgba(255,255,255,.1); margin: 0 .35rem 1.7rem; }
  .ms-line.reached { background: var(--accent); opacity: .5; }
  .journey-note { font-size: .92rem; color: var(--muted); line-height: 1.6; margin: 0; }
  .journey-note strong { color: var(--ink); font-weight: 600; }

  @media (max-width: 860px) {
    .stats-row { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 760px) {
    .goal-hero { grid-template-columns: 1fr; }
    .gh-right { padding-left: 0; border-left: none; border-top: 1px solid var(--line); padding-top: 1.5rem; }
    .stats-row { grid-template-columns: 1fr 1fr; }
    .liberte { grid-template-columns: 1fr; gap: 1.6rem; }
    .lib-right { padding-left: 0; border-left: none; border-top: 1px solid var(--line); padding-top: 1.5rem; }
    .adjust { flex-direction: column; align-items: flex-start; gap: 1rem; }
  }
</style>

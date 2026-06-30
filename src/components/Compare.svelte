<script>
  import { onMount } from 'svelte';
  import { loadState, CURRENT_YEAR } from '../lib/store.js';
  import { projectPortfolio, projectSimple } from '../lib/finance.js';

  // Cherche le rendement unique qui reproduit la vraie projection multi-actifs,
  // pour que le scénario A colle exactement au tableau de bord.
  function calibrateRate(target, initial, monthly, months, stepUp) {
    let lo = 0, hi = 25;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (projectSimple(initial, monthly, mid, months, stepUp, 0) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const grouped = new Intl.NumberFormat('fr-FR');
  const fmtNum = (v) => grouped.format(Math.round(v || 0));

  let state = null;
  let ready = false;

  // Scénario B (éditable)
  let bMonthly = 0, bStepUp = 0, bDelay = 0, bYear = 2035, bReturn = 7;

  onMount(() => {
    state = loadState();
    const cl = state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, ter: +p.ter || 0 }));
    const aM = cl.reduce((s, p) => s + p.monthly, 0);
    const init = cl.reduce((s, p) => s + p.initial, 0);
    const months = (state.targetYear - CURRENT_YEAR) * 12;
    const real = projectPortfolio(cl, CURRENT_YEAR, state.targetYear, state.stepUp || 0);
    const eff = calibrateRate(real.totals.realistic[real.months], init, aM, months, state.stepUp || 0);
    bMonthly = aM;
    bStepUp = state.stepUp || 0;
    bYear = state.targetYear;
    bReturn = Math.round(eff * 10) / 10;
    ready = true;
  });

  $: clean = ready ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, ter: +p.ter || 0 })) : [];
  $: totalInitial = clean.reduce((s, p) => s + p.initial, 0);
  $: aMonthly = clean.reduce((s, p) => s + p.monthly, 0);
  $: aYear = ready ? state.targetYear : 2035;
  $: aStepUp = ready ? state.stepUp || 0 : 0;
  $: aMonths = (aYear - CURRENT_YEAR) * 12;
  $: bMonths = (bYear - CURRENT_YEAR) * 12;

  // Scénario A = vraie projection multi-actifs (identique au tableau de bord)
  $: realA = ready ? projectPortfolio(clean, CURRENT_YEAR, aYear, aStepUp) : null;
  $: finalA = realA ? realA.totals.realistic[realA.months] || 0 : 0;
  $: aReturn = ready ? calibrateRate(finalA, totalInitial, aMonthly, aMonths, aStepUp) : 0;
  $: finalB = ready ? projectSimple(totalInitial, bMonthly, bReturn, bMonths, bStepUp, bDelay * 12) : 0;
  $: delta = finalB - finalA;
  $: maxV = Math.max(finalA, finalB, 1);
  $: bestA = Math.abs(delta) >= 1 && finalA > finalB;
  $: bestB = Math.abs(delta) >= 1 && finalB > finalA;

  const chips = [
    { label: '+20 % d\'épargne', apply: () => (bMonthly = Math.round(aMonthly * 1.2)) },
    { label: 'Versements +5 %/an', apply: () => (bStepUp = 5) },
    { label: 'Commencer dans 5 ans', apply: () => (bDelay = 5) },
    { label: 'Horizon +5 ans', apply: () => (bYear = aYear + 5) },
    { label: 'Profil dynamique (9 %)', apply: () => (bReturn = 9) },
  ];
  function reset() {
    bMonthly = aMonthly; bStepUp = aStepUp; bDelay = 0; bYear = aYear; bReturn = Math.round(aReturn * 10) / 10;
  }
</script>

{#if ready}
  <div class="cmp">
    <!-- Scénario A -->
    <section class="panel scen" class:winner={bestA}>
      <div class="scen-head"><span class="scen-tag">Scénario A · Ton plan actuel</span>{#if bestA}<span class="best">Meilleur scénario</span>{/if}</div>
      <div class="scen-final"><span class="num">{fmtNum(finalA)}</span> <span class="cur">FCFP</span></div>
      <div class="scen-bar"><div class="scen-fill a" style="width:{(finalA / maxV) * 100}%"></div></div>
      <dl class="scen-params">
        <div><dt>Versement / mois</dt><dd class="num">{fmtNum(aMonthly)} FCFP</dd></div>
        <div><dt>Versements progressifs</dt><dd class="num">+{aStepUp} %/an</dd></div>
        <div><dt>Départ</dt><dd>immédiat</dd></div>
        <div><dt>Horizon</dt><dd class="num">{aYear}</dd></div>
        <div><dt>Rendement moyen</dt><dd class="num">{aReturn.toFixed(1)} %/an</dd></div>
      </dl>
    </section>

    <!-- Scénario B -->
    <section class="panel scen b" class:winner={bestB}>
      <div class="scen-head"><span class="scen-tag">Scénario B · Simulation</span>{#if bestB}<span class="best">Meilleur scénario</span>{/if}</div>
      <div class="scen-final"><span class="num">{fmtNum(finalB)}</span> <span class="cur">FCFP</span></div>
      <div class="scen-bar"><div class="scen-fill b" style="width:{(finalB / maxV) * 100}%"></div></div>
      <div class="scen-edit">
        <label><span>Versement / mois</span><div class="input-eur sm"><input type="number" min="0" step="5000" bind:value={bMonthly} /><em>XPF</em></div></label>
        <label><span>Versements progressifs : <strong>+{bStepUp} %</strong>/an</span><input class="slider" type="range" min="0" max="10" step="0.5" bind:value={bStepUp} /></label>
        <label><span>Décaler le départ : <strong>{bDelay}</strong> an{bDelay > 1 ? 's' : ''}</span><input class="slider" type="range" min="0" max="15" step="1" bind:value={bDelay} /></label>
        <label><span>Horizon : <strong>{bYear}</strong></span><input class="slider" type="range" min={CURRENT_YEAR + 1} max="2065" bind:value={bYear} /></label>
        <label><span>Rendement : <strong>{bReturn} %</strong>/an</span><input class="slider" type="range" min="0" max="12" step="0.5" bind:value={bReturn} /></label>
      </div>
    </section>
  </div>

  <!-- Verdict -->
  <section class="panel verdict">
    <div class="v-left">
      <span class="v-k">Écart à l'échéance</span>
      <span class="v-amount {delta >= 0 ? 'pos' : 'neg'}"><span class="num">{delta >= 0 ? '+' : '−'}{fmtNum(Math.abs(delta))}</span> <span class="cur">FCFP</span></span>
    </div>
    <p class="v-text">
      {#if Math.abs(delta) < 1}
        Les deux scénarios aboutissent au même résultat.
      {:else if delta >= 0}
        Le scénario B te rapporte <strong>{fmtNum(delta)} FCFP de plus</strong> que ton plan actuel — soit <strong>{((finalB / finalA - 1) * 100).toFixed(0)} %</strong> de patrimoine en plus.
      {:else}
        Le scénario B te coûte <strong>{fmtNum(-delta)} FCFP</strong> par rapport à ton plan actuel.
        {#if bDelay > 0} Décaler ton départ de {bDelay} an{bDelay > 1 ? 's' : ''} a un prix élevé : le temps est ton meilleur allié.{/if}
      {/if}
    </p>
  </section>

  <div class="chips">
    {#each chips as c}<button class="chip-btn" on:click={c.apply}>{c.label}</button>{/each}
    <button class="chip-btn reset" on:click={reset}>Réinitialiser B</button>
  </div>

  <p class="muted-text" style="margin-top:1.6rem">Projection simplifiée à rendement moyen pondéré, à partir de ton capital de départ actuel ({fmtNum(totalInitial)} FCFP). Indicatif.</p>
{:else}
  <p class="muted-text">Chargement…</p>
{/if}

<style>
  .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; margin-bottom: 1.1rem; }
  .scen { display: flex; flex-direction: column; transition: border-color .15s; }
  .scen.winner { border-color: rgba(201,168,93,.35); }
  .scen-head { display: flex; align-items: center; justify-content: space-between; gap: .6rem; margin-bottom: 1rem; }
  .scen-tag { font-size: .82rem; color: var(--muted); }
  .scen.b .scen-tag { color: var(--accent); }
  .best { font-size: .68rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); background: rgba(201,168,93,.15); padding: .26rem .6rem; border-radius: 999px; }
  .scen-final { display: flex; align-items: baseline; gap: .4rem; }
  .scen-final .num { font-size: clamp(1.9rem, 4vw, 2.6rem); font-weight: 700; letter-spacing: -.03em; }
  .scen-final .cur { font-size: .85rem; color: var(--muted); }
  .scen-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.06); overflow: hidden; margin: 1rem 0 1.5rem; }
  .scen-fill { height: 100%; border-radius: 999px; transition: width .3s; }
  .scen-fill.a { background: rgba(255,255,255,.45); }
  .scen-fill.b { background: var(--accent); }

  .scen-params { display: flex; flex-direction: column; gap: .7rem; margin: 0; }
  .scen-params > div { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .scen-params dt { font-size: .85rem; color: var(--muted); margin: 0; }
  .scen-params dd { margin: 0; font-size: .9rem; font-weight: 500; }

  .scen-edit { display: flex; flex-direction: column; gap: 1rem; }
  .scen-edit label { display: block; }
  .scen-edit label > span { display: block; font-size: .82rem; color: var(--muted); margin-bottom: .45rem; }
  .scen-edit strong { color: var(--ink); }

  .verdict { display: flex; align-items: center; gap: 2rem; margin-bottom: 1.1rem; }
  .v-left { display: flex; flex-direction: column; gap: .4rem; flex-shrink: 0; }
  .v-k { font-size: .82rem; color: var(--muted); }
  .v-amount { font-size: 1.7rem; font-weight: 700; letter-spacing: -.02em; }
  .v-amount.pos { color: var(--green); }
  .v-amount.neg { color: var(--red); }
  .v-amount .cur { font-size: .85rem; color: var(--muted); font-weight: 400; }
  .v-text { font-size: .95rem; line-height: 1.6; color: #c8c8c8; margin: 0; }
  .v-text strong { color: var(--ink); font-weight: 600; }

  .chips { display: flex; flex-wrap: wrap; gap: .6rem; }
  .chip-btn { background: #151515; border: 1px solid rgba(255,255,255,.08); color: var(--muted); font-size: .82rem; padding: .5rem .85rem; border-radius: 999px; cursor: pointer; font-family: inherit; transition: color .15s, border-color .15s; }
  .chip-btn:hover { color: var(--ink); border-color: rgba(255,255,255,.16); }
  .chip-btn.reset { color: var(--faint); }

  @media (max-width: 820px) {
    .cmp { grid-template-columns: 1fr; }
    .verdict { flex-direction: column; align-items: flex-start; gap: 1rem; }
  }
</style>

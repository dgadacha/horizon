<script>
  import { onMount } from 'svelte';
  import { loadState, CURRENT_YEAR } from '../lib/store.js';
  import { projectPortfolio, formatShort } from '../lib/finance.js';

  let state = null;
  let ready = false;

  onMount(() => {
    state = loadState();
    ready = true;
    const sync = () => (state = loadState());
    window.addEventListener('horizon:save', sync);
    return () => window.removeEventListener('horizon:save', sync);
  });

  $: clean = ready
    ? state.placements.map((p) => ({ ...p, monthly: +p.monthly || 0, initial: +p.initial || 0, meanReturn: +p.meanReturn || 0, ter: +p.ter || 0 }))
    : [];
  $: result = ready ? projectPortfolio(clean, CURRENT_YEAR, state.targetYear, state.stepUp || 0) : null;
  $: projected = result ? result.totals.realistic[result.months] || 0 : 0;
  $: progress = ready && state.goal > 0 ? Math.min(100, (projected / state.goal) * 100) : 0;
</script>

{#if ready}
  <a class="profile" href="/parametres">
    <div class="avatar">{(state.settings.name || '?').trim().charAt(0).toUpperCase()}</div>
    <span class="name">{state.settings.name || 'Mon profil'}</span>
  </a>
  <div class="prof-body">
    <div class="line"><span class="lk">Patrimoine projeté</span><span class="lv num">{formatShort(projected)}</span></div>
    {#if state.goal > 0}
      <div class="line"><span class="lk">Objectif</span><span class="lv num">{formatShort(state.goal)}</span></div>
      <div class="bar"><div class="fill" style="width:{progress}%"></div></div>
      <div class="prog-pct num">{progress.toFixed(0)} %</div>
    {:else}
      <a class="set-goal" href="/objectifs">Définir un objectif →</a>
    {/if}
  </div>
{/if}

<style>
  .profile { display: flex; align-items: center; gap: .65rem; padding: .55rem; border-radius: 12px; text-decoration: none; transition: background .15s; margin-top: 1rem; }
  .profile:hover { background: rgba(255,255,255,.04); }
  .avatar { width: 34px; height: 34px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #050505; flex-shrink: 0; font-size: .9rem; }
  .name { font-weight: 600; font-size: .92rem; color: var(--ink); }
  .prof-body { margin-top: .9rem; padding: .9rem .65rem 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: .55rem; }
  .line { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .lk { font-size: .74rem; color: var(--muted); }
  .lv { font-size: .82rem; color: var(--ink); font-weight: 600; text-align: right; }
  .bar { height: 4px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; margin-top: .15rem; }
  .fill { height: 100%; border-radius: 999px; background: var(--accent); }
  .prog-pct { font-size: .78rem; color: var(--accent); font-weight: 600; text-align: right; }
  .set-goal { font-size: .76rem; color: var(--muted); text-decoration: none; }
  .set-goal:hover { color: var(--ink); }

  @media (max-width: 860px) { .profile, .prof-body { display: none; } }
</style>

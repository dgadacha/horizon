import { getPreset } from './presets.js';

// Moteur de projection : interets composes avec versements mensuels, multi-placements.
//
// Pour chaque placement on simule mois par mois :
//   capital(m) = capital(m-1) * (1 + r_mensuel) + versement_mensuel
// avec r_mensuel derive du rendement annuel NET de frais (TER).
//
// Trois scenarios sont calcules en faisant varier le rendement annuel autour de la
// moyenne historique en fonction de la volatilite du placement :
//   - pessimiste  = moyenne - SPREAD * volatilite
//   - realiste    = moyenne
//   - optimiste   = moyenne + SPREAD * volatilite
// (modele simplifie a rendement constant : indicatif, pas une prevision certaine.)

const SPREAD = 0.45;

function monthlyRate(annualPct) {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

// Rendements annuels nets de frais pour les 3 scenarios d'un placement.
export function scenarioReturns(placement) {
  const net = placement.meanReturn - placement.ter;
  const band = SPREAD * placement.volatility;
  return {
    pessimistic: Math.max(net - band, -50),
    realistic: net,
    optimistic: net + band,
  };
}

// Nombre de mois entre maintenant (startYear) et la fin de l'annee cible.
export function monthsUntil(startYear, targetYear) {
  return Math.max(0, (targetYear - startYear) * 12);
}

// Projette UN placement sur n mois, renvoie le tableau des valeurs mensuelles
// pour un rendement annuel donne.
function projectOne(initial, monthly, annualPct, months, stepUpPct = 0) {
  const r = monthlyRate(annualPct);
  const g = stepUpPct / 100;
  const series = [];
  let capital = initial;
  let pmt = monthly;
  series.push(capital);
  for (let m = 1; m <= months; m++) {
    capital = capital * (1 + r) + pmt;
    series.push(capital);
    if (m % 12 === 0) pmt *= 1 + g; // versements progressifs : +stepUp %/an
  }
  return series;
}

// Projette TOUT le portefeuille. Renvoie, par scenario, la serie mensuelle agregee
// (somme de tous les placements) + le detail par placement a l'echeance.
export function projectPortfolio(placements, startYear, targetYear, stepUpPct = 0) {
  const months = monthsUntil(startYear, targetYear);
  const g = stepUpPct / 100;
  const scenarios = ['pessimistic', 'realistic', 'optimistic'];

  const totals = {
    pessimistic: new Array(months + 1).fill(0),
    realistic: new Array(months + 1).fill(0),
    optimistic: new Array(months + 1).fill(0),
  };
  // Total verse (capital investi cumule), independant du scenario.
  const invested = new Array(months + 1).fill(0);

  const perPlacement = [];

  for (const p of placements) {
    const rr = scenarioReturns(p);
    const lines = {};
    for (const s of scenarios) {
      const serie = projectOne(p.initial, p.monthly, rr[s], months, stepUpPct);
      lines[s] = serie;
      for (let m = 0; m <= months; m++) totals[s][m] += serie[m];
    }
    let invPmt = p.monthly;
    let invAcc = p.initial;
    for (let m = 0; m <= months; m++) {
      invested[m] += invAcc;
      if (m < months) { invAcc += invPmt; if ((m + 1) % 12 === 0) invPmt *= 1 + g; }
    }
    // Mini-courbe (sparkline) du scenario realiste, ~24 points.
    const spark = [];
    const step = Math.max(1, Math.floor(months / 24));
    for (let m = 0; m <= months; m += step) spark.push(lines.realistic[m]);
    if (spark[spark.length - 1] !== lines.realistic[months]) spark.push(lines.realistic[months]);

    perPlacement.push({
      placement: p,
      returns: rr,
      final: {
        pessimistic: lines.pessimistic[months],
        realistic: lines.realistic[months],
        optimistic: lines.optimistic[months],
      },
      invested: p.initial + p.monthly * months,
      spark,
    });
  }

  return { months, totals, invested, perPlacement };
}

// Convertit une valeur nominale future en pouvoir d'achat d'aujourd'hui.
export function toReal(nominal, inflationPct, years) {
  return nominal / Math.pow(1 + inflationPct / 100, years);
}

// Applique l'impot sur la plus-value (le capital verse n'est pas taxe).
export function afterTax(finalValue, investedValue, taxPct) {
  const gain = Math.max(0, finalValue - investedValue);
  return investedValue + gain * (1 - taxPct / 100);
}

// ---- Objectif : combien faut-il epargner par mois pour atteindre `goal` ? ----
// On garde la repartition actuelle entre placements (ou egale si rien n'est verse)
// et on cherche par dichotomie le versement mensuel total (scenario realiste).
export function solveGoal(placements, startYear, targetYear, goal, stepUpPct = 0) {
  const months = monthsUntil(startYear, targetYear);
  if (months === 0 || !goal || goal <= 0 || placements.length === 0) return null;

  const totalMonthly = placements.reduce((s, p) => s + (+p.monthly || 0), 0);
  const n = placements.length;
  const weights = placements.map((p) =>
    totalMonthly > 0 ? (+p.monthly || 0) / totalMonthly : 1 / n,
  );
  const rates = placements.map((p) => monthlyRate(p.meanReturn - p.ter));
  const initials = placements.map((p) => +p.initial || 0);

  const g = stepUpPct / 100;
  function fv(monthlyTotal) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      let cap = initials[i];
      const r = rates[i];
      let pmt = monthlyTotal * weights[i];
      for (let m = 1; m <= months; m++) { cap = cap * (1 + r) + pmt; if (m % 12 === 0) pmt *= 1 + g; }
      total += cap;
    }
    return total;
  }

  if (fv(0) >= goal) return 0; // le capital de depart suffit deja
  let lo = 0;
  let hi = 1e9;
  for (let it = 0; it < 70; it++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < goal) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- Simulation Monte-Carlo ----
// Au lieu de rendements constants, on tire chaque annee un rendement aleatoire
// (loi normale autour de la moyenne, ecart-type = volatilite) pour chaque
// placement, puis on calcule les percentiles p10 / p50 / p90 du portefeuille.
function randNormal(mean, std) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

function quantile(sortedArr, q) {
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  }
  return sortedArr[base];
}

export function monteCarlo(placements, startYear, targetYear, runs = 600, stepUpPct = 0) {
  const months = monthsUntil(startYear, targetYear);
  const years = targetYear - startYear;
  const n = placements.length;
  const all = [];

  for (let run = 0; run < runs; run++) {
    const caps = placements.map((p) => +p.initial || 0);
    const series = new Array(months + 1).fill(0);
    series[0] = caps.reduce((a, b) => a + b, 0);
    let m = 0;
    const g = stepUpPct / 100;
    const pmts = placements.map((p) => +p.monthly || 0);
    for (let y = 0; y < years; y++) {
      const ratesY = placements.map((p) => {
        const annual = randNormal(p.meanReturn - p.ter, p.volatility);
        return Math.pow(1 + Math.max(annual, -95) / 100, 1 / 12) - 1;
      });
      for (let mm = 0; mm < 12 && m < months; mm++) {
        m++;
        for (let i = 0; i < n; i++) {
          caps[i] = caps[i] * (1 + ratesY[i]) + pmts[i];
        }
        series[m] = caps.reduce((a, b) => a + b, 0);
      }
      for (let i = 0; i < pmts.length; i++) pmts[i] *= 1 + g;
    }
    all.push(series);
  }

  const p10 = [];
  const p50 = [];
  const p90 = [];
  for (let m = 0; m <= months; m++) {
    const col = all.map((s) => s[m]).sort((a, b) => a - b);
    p10.push(quantile(col, 0.1));
    p50.push(quantile(col, 0.5));
    p90.push(quantile(col, 0.9));
  }
  const finals = all.map((s) => s[months]).sort((a, b) => a - b);
  return { months, p10, p50, p90, finals, runs };
}

// Probabilite d'atteindre l'objectif (part des tirages Monte-Carlo >= goal).
export function probReachGoal(finals, goal) {
  if (!finals || !finals.length || !goal) return null;
  const ok = finals.filter((v) => v >= goal).length;
  return (ok / finals.length) * 100;
}

// Nombre de mois (scenario realiste) avant d'atteindre l'objectif, en gardant
// les versements actuels. null si non atteint dans la limite.
export function monthsToGoal(placements, goal, stepUpPct = 0, maxMonths = 1200) {
  if (!goal || goal <= 0) return 0;
  const rates = placements.map((p) => monthlyRate(p.meanReturn - p.ter));
  const caps = placements.map((p) => +p.initial || 0);
  const pmts = placements.map((p) => +p.monthly || 0);
  const g = stepUpPct / 100;
  let total = caps.reduce((a, b) => a + b, 0);
  if (total >= goal) return 0;
  for (let m = 1; m <= maxMonths; m++) {
    for (let i = 0; i < placements.length; i++) {
      caps[i] = caps[i] * (1 + rates[i]) + pmts[i];
    }
    if (m % 12 === 0) for (let i = 0; i < pmts.length; i++) pmts[i] *= 1 + g;
    total = caps.reduce((a, b) => a + b, 0);
    if (total >= goal) return m;
  }
  return null;
}

// Rendement annuel net moyen pondere du portefeuille (par capital + versements).
export function blendedNetReturn(placements) {
  const w = placements.reduce((s, p) => s + (+p.monthly || 0) + (+p.initial || 0), 0) || 1;
  return placements.reduce((s, p) => s + (p.meanReturn - p.ter) * ((+p.monthly || 0) + (+p.initial || 0)), 0) / w;
}

// Projecteur mono-ligne (rendement unique) pour le comparateur et le suivi.
// delayMonths : on n'investit pas pendant le delai (l'argent dort, pas de croissance).
export function projectSimple(initial, monthly, annualPct, months, stepUpPct = 0, delayMonths = 0) {
  const r = monthlyRate(annualPct);
  const g = stepUpPct / 100;
  let cap = initial;
  let pmt = monthly;
  for (let m = 1; m <= months; m++) {
    if (m > delayMonths) {
      cap = cap * (1 + r) + pmt;
      if ((m - delayMonths) % 12 === 0) pmt *= 1 + g;
    }
  }
  return cap;
}

// Indice patrimoine (0-100) : epargne + diversification + exposition croissance + horizon.
export function wealthScore({ savingsRate, placements, years }) {
  const distinct = new Set(placements.filter((p) => (+p.monthly || 0) > 0 || (+p.initial || 0) > 0).map((p) => p.presetId)).size;
  const invested = placements.filter((p) => (+p.monthly || 0) > 0 || (+p.initial || 0) > 0);
  const totalW = invested.reduce((s, p) => s + (+p.monthly || 0) + (+p.initial || 0), 0) || 1;
  const avgNet = invested.reduce((s, p) => s + (p.meanReturn - p.ter) * ((+p.monthly || 0) + (+p.initial || 0)), 0) / totalW;

  const epargne = Math.min(40, (Math.min(savingsRate, 35) / 35) * 40);
  const diversif = Math.min(20, distinct * 7);
  const croissance = Math.min(25, Math.max(0, (avgNet - 2) / 7) * 25);
  const horizon = Math.min(15, (Math.max(0, years - 3) / 17) * 15);
  return Math.round(Math.min(100, epargne + diversif + croissance + horizon));
}

// Synthese patrimoniale partagee (score, risque, diversification, allocations).
export function analyzePortfolio({ savingsRate, placements, years, perPlacement }) {
  const score = wealthScore({ savingsRate, placements, years });
  const percentile = Math.min(95, Math.round(28 + score * 0.62));
  const totalFinal = perPlacement.reduce((s, r) => s + r.final.realistic, 0) || 1;
  const allocs = perPlacement
    .map((r) => ({
      name: r.placement.name,
      color: getPreset(r.placement.presetId).color,
      alloc: (r.final.realistic / totalFinal) * 100,
      vol: r.placement.volatility,
      net: r.placement.meanReturn - r.placement.ter,
      value: r.final.realistic,
      spark: r.spark,
    }))
    .sort((a, b) => b.value - a.value);
  const weightedVol = allocs.reduce((s, a) => s + a.vol * (a.alloc / 100), 0);
  const risk = weightedVol < 8 ? 'Faible' : weightedVol < 16 ? 'Modéré' : 'Élevé';
  const distinct = new Set(
    placements.filter((p) => (+p.monthly || 0) > 0 || (+p.initial || 0) > 0).map((p) => p.presetId),
  ).size;
  const top = allocs[0];
  const concentrated = top ? top.alloc > 60 : false;
  const diversif =
    distinct >= 4 && !concentrated ? 'Excellente'
    : distinct >= 3 && !concentrated ? 'Très bonne'
    : distinct >= 2 ? 'Bonne'
    : 'Faible';
  return { score, percentile, weightedVol, risk, diversif, allocs, top, note: (score / 10).toFixed(1) };
}

// Echelle de jalons de patrimoine autour de la valeur projetee (fenetre glissante).
export function milestoneLadder(projected, count = 5) {
  const ladder = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2.5e8, 5e8, 1e9];
  let next = ladder.findIndex((v) => v > projected);
  if (next === -1) next = ladder.length - 1;
  let end = Math.min(ladder.length, Math.max(0, next - 3) + count);
  const start = Math.max(0, end - count);
  return ladder.slice(start, end).map((v) => ({ value: v, reached: projected >= v }));
}

// Format court : 1 200 000 -> "1,2 M", 9 500 000 -> "9,5 M".
export function formatShort(value) {
  const v = value || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1).replace('.', ',') + ' Md';
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace('.', ',') + ' M';
  if (v >= 1e3) return Math.round(v / 1e3) + ' k';
  return '' + Math.round(v);
}

// Formatage en franc Pacifique (XPF / FCFP), sans decimales.
export function formatXPF(value) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'XPF',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

export function formatPct(value, decimals = 1) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)} %`;
}

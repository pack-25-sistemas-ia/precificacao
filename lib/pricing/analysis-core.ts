// Análise por item × canal usando SOMENTE o motor (lib/pricing/engine): o banco entrega custo vigente, taxas e política já resolvidos
// (pr_analysis_inputs); aqui avaliamos, calculamos preço-alvo/equilíbrio e classificamos o risco. Funções puras (testáveis sem banco).
import { D, type Dec, classifyRisk, evaluate, solvePrice, type EvalResult, type FeeLine, type RiskResult, type RoundingRule, type SolveResult } from './engine';

export type AnalysisInput = {
  item_id: string; sku: string; name: string; item_type: 'product' | 'service'; category_id: string | null; category: string | null;
  channel_id: string; channel: string;
  price_cents: number | null; price_source: 'channel' | 'base' | null; days_since_review: number | null; last_price_change_at: string | null;
  cost: { version_id: string; version_number: number; direct_unit_cents: number; overhead_unit_cents: number | null; full_unit_cents: number | null } | null;
  live_cost_complete: boolean; cost_issues: Array<{ code: string; component_id?: string }>; previous_direct_unit_cents: number | null;
  fees: Array<{ id: string; name: string; kind: string; basis: string; rate_pct?: number | null; fixed_cents?: number | null; min_cents?: number | null; max_cents?: number | null }>;
  policy: { scope: string; policy_id: string | null; version_number: number | null; rules: { target_margin_pct: number; minimum_margin_pct: number; max_discount_pct: number | null; rounding: string; min_price_cents: number | null } };
};

export type AnalysisRow = {
  itemId: string; sku: string; name: string; itemType: 'product' | 'service'; categoryId: string | null; category: string; channelId: string; channel: string;
  priceCents: number | null; priceSource: 'channel' | 'base' | null; hasVersion: boolean; costComplete: boolean; costVersion: number | null;
  directUnit: string | null; overheadUnit: string | null; previousDirectUnit: string | null;
  policyScope: string; policyVersion: number | null; targetMarginPct: string; minimumMarginPct: string; maxDiscountPct: string | null; rounding: RoundingRule;
  evaluation: EvalResult | null; marginPct: string | null; contributionCents: number | null;
  target: SolveResult | null; equilibrium: SolveResult | null; targetPriceCents: number | null; equilibriumPriceCents: number | null; priceGapPct: string | null;
  fees: FeeLine[]; risk: RiskResult; error: string | null;
};

const asFee = (f: AnalysisInput['fees'][number]): FeeLine => ({
  id: f.id, name: f.name, kind: f.kind as FeeLine['kind'], basis: f.basis as FeeLine['basis'],
  ratePct: f.rate_pct ?? null, fixedCents: f.fixed_cents ?? null, minCents: f.min_cents ?? null, maxCents: f.max_cents ?? null,
});

export function analyzeRow(r: AnalysisInput, reviewAfterDays = 90): AnalysisRow {
  const rules = r.policy.rules;
  const rounding = (rules.rounding as RoundingRule) ?? 'nearest';
  const hasVersion = !!r.cost && Number.isFinite(Number(r.cost.direct_unit_cents));
  const costComplete = hasVersion && r.live_cost_complete;
  const fees = r.fees.map(asFee);
  const base: AnalysisRow = {
    itemId: r.item_id, sku: r.sku, name: r.name, itemType: r.item_type, categoryId: r.category_id, category: r.category ?? 'Sem categoria', channelId: r.channel_id, channel: r.channel,
    priceCents: r.price_cents, priceSource: r.price_source, hasVersion, costComplete, costVersion: r.cost?.version_number ?? null,
    directUnit: hasVersion ? String(r.cost!.direct_unit_cents) : null, overheadUnit: r.cost?.overhead_unit_cents == null ? null : String(r.cost.overhead_unit_cents),
    previousDirectUnit: r.previous_direct_unit_cents == null ? null : String(r.previous_direct_unit_cents),
    policyScope: r.policy.scope, policyVersion: r.policy.version_number, targetMarginPct: String(rules.target_margin_pct), minimumMarginPct: String(rules.minimum_margin_pct),
    maxDiscountPct: rules.max_discount_pct == null ? null : String(rules.max_discount_pct), rounding,
    evaluation: null, marginPct: null, contributionCents: null, target: null, equilibrium: null, targetPriceCents: null, equilibriumPriceCents: null, priceGapPct: null, fees,
    risk: { state: 'no_price', label: '', reasons: [] }, error: null,
  };
  let ruleInvalid = false;
  try {
    if (hasVersion) {
      const common = { variableUnitCost: base.directUnit!, overheadUnit: base.overheadUnit, fees };
      base.target = solvePrice({ ...common, targetMarginPct: rules.target_margin_pct, rounding, floorCents: rules.min_price_cents });
      base.equilibrium = solvePrice({ ...common, targetMarginPct: 0, rounding: 'up' });
      ruleInvalid = base.target.status !== 'ok';
      if (base.target.status === 'ok') base.targetPriceCents = base.target.priceCents;
      if (base.equilibrium.status === 'ok') base.equilibriumPriceCents = base.equilibrium.priceCents;
      if (r.price_cents !== null && r.price_cents > 0) {
        base.evaluation = evaluate({ priceCents: r.price_cents, ...common });
        base.marginPct = base.evaluation.marginPct;
        base.contributionCents = base.evaluation.contributionCents;
        if (base.targetPriceCents !== null) base.priceGapPct = new D(r.price_cents).minus(base.targetPriceCents).div(base.targetPriceCents).mul(100).toDecimalPlaces(4).toFixed(4);
      }
    }
  } catch (e) {
    ruleInvalid = true;
    base.error = e instanceof Error ? e.message : 'Erro de cálculo';
  }
  base.risk = classifyRisk({
    costComplete, evaluation: base.evaluation, hasPrice: r.price_cents !== null, ruleInvalid,
    policy: { targetMarginPct: base.targetMarginPct, minimumMarginPct: base.minimumMarginPct }, daysSincePriceReview: r.days_since_review, reviewAfterDays,
  });
  return base;
}

// ======================================================================= indicadores (docs/METRICS.md)
const mean = (xs: Dec[]): string | null => (xs.length ? xs.reduce((s, x) => s.plus(x), new D(0)).div(xs.length).toDecimalPlaces(4).toFixed(4) : null);
const distinct = <T,>(xs: T[]) => new Set(xs).size;

export type Kpis = {
  itemsAnalyzed: number; averageMarginSimplePct: string | null; marginPairs: number;
  belowTargetItems: number; belowTargetPairs: number; negativeContributionItems: number; negativeContributionPairs: number; incompleteCostItems: number;
  averagePriceGapPct: string | null; gapPairs: number; itemsByChannel: Array<{ channelId: string; channel: string; items: number }>;
  costVariationAvgPct: string | null; costVariationItems: number; costIncreasedItems: number;
};

export function computeKpis(rows: AnalysisRow[]): Kpis {
  const withEval = rows.filter((r) => r.evaluation && r.marginPct !== null);
  const below = rows.filter((r) => r.risk.state === 'below_target');
  const neg = rows.filter((r) => r.risk.state === 'negative_contribution');
  const incomplete = rows.filter((r) => r.risk.state === 'incomplete_cost');
  const gaps = rows.filter((r) => r.priceGapPct !== null);
  const byChannel = new Map<string, { channel: string; items: Set<string> }>();
  for (const r of rows) if (r.priceCents !== null) { const e = byChannel.get(r.channelId) ?? { channel: r.channel, items: new Set<string>() }; e.items.add(r.itemId); byChannel.set(r.channelId, e); }
  const seen = new Set<string>();
  const variations: Dec[] = [];
  let increased = 0;
  for (const r of rows) {
    if (seen.has(r.itemId)) continue;
    seen.add(r.itemId);
    if (r.directUnit !== null && r.previousDirectUnit !== null && new D(r.previousDirectUnit).gt(0)) {
      const v = new D(r.directUnit).minus(r.previousDirectUnit).div(r.previousDirectUnit).mul(100);
      variations.push(v);
      if (v.gt(0)) increased++;
    }
  }
  return {
    itemsAnalyzed: distinct(withEval.map((r) => r.itemId)),
    averageMarginSimplePct: mean(withEval.map((r) => new D(r.marginPct!))), marginPairs: withEval.length,
    belowTargetItems: distinct(below.map((r) => r.itemId)), belowTargetPairs: below.length,
    negativeContributionItems: distinct(neg.map((r) => r.itemId)), negativeContributionPairs: neg.length,
    incompleteCostItems: distinct(incomplete.map((r) => r.itemId)),
    averagePriceGapPct: mean(gaps.map((r) => new D(r.priceGapPct!))), gapPairs: gaps.length,
    itemsByChannel: [...byChannel.entries()].map(([channelId, v]) => ({ channelId, channel: v.channel, items: v.items.size })).sort((a, b) => b.items - a.items),
    costVariationAvgPct: mean(variations), costVariationItems: variations.length, costIncreasedItems: increased,
  };
}

export type ChartData = {
  marginByCategory: Array<{ name: string; marginPct: number; items: number }>;
  marginBands: Array<{ band: string; count: number }>;
  currentVsTarget: Array<{ name: string; currentCents: number; targetCents: number }>;
  channelComparison: Array<{ name: string; marginPct: number; contributionCents: number; items: number }>;
  composition: Array<{ name: string; pct: number }>;
  biggestGaps: Array<{ name: string; gapPp: number }>;
  lowestMargins: Array<{ name: string; marginPct: number }>;
};

const BANDS: Array<[string, (m: Dec) => boolean]> = [
  ['Negativa', (m) => m.lt(0)], ['0–10 %', (m) => m.gte(0) && m.lt(10)], ['10–20 %', (m) => m.gte(10) && m.lt(20)], ['20–30 %', (m) => m.gte(20) && m.lt(30)], ['30–40 %', (m) => m.gte(30) && m.lt(40)], ['40 % ou mais', (m) => m.gte(40)],
];

export function computeCharts(rows: AnalysisRow[]): ChartData {
  const ev = rows.filter((r) => r.evaluation && r.marginPct !== null);
  const label = (r: AnalysisRow) => `${r.sku}${rows.some((x) => x.itemId === r.itemId && x.channelId !== r.channelId) ? ` · ${r.channel}` : ''}`;
  const group = <K,>(key: (r: AnalysisRow) => K) => { const m = new Map<K, AnalysisRow[]>(); for (const r of ev) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); } return m; };
  const avgMargin = (xs: AnalysisRow[]) => Number(mean(xs.map((x) => new D(x.marginPct!))) ?? 0);
  const total = ev.reduce((s, r) => s.plus(r.evaluation!.revenueCents), new D(0));
  const sum = (f: (r: AnalysisRow) => number) => ev.reduce((s, r) => s.plus(f(r)), new D(0));
  const pctOf = (x: Dec) => (total.gt(0) ? x.div(total).mul(100).toDecimalPlaces(2).toNumber() : 0);
  const gapRows = ev.filter((r) => r.targetPriceCents !== null).map((r) => ({ r, gap: new D(r.targetMarginPct).minus(r.marginPct!) })).filter((x) => x.gap.gt(0)).sort((a, b) => b.gap.cmp(a.gap)).slice(0, 10);
  return {
    marginByCategory: [...group((r) => r.category).entries()].map(([name, xs]) => ({ name, marginPct: avgMargin(xs), items: distinct(xs.map((x) => x.itemId)) })).sort((a, b) => b.marginPct - a.marginPct),
    marginBands: BANDS.map(([band, test]) => ({ band, count: ev.filter((r) => test(new D(r.marginPct!))).length })),
    currentVsTarget: ev.filter((r) => r.targetPriceCents !== null && r.priceCents !== null).sort((a, b) => Math.abs((b.priceCents! - b.targetPriceCents!)) - Math.abs((a.priceCents! - a.targetPriceCents!))).slice(0, 10).map((r) => ({ name: label(r), currentCents: r.priceCents!, targetCents: r.targetPriceCents! })),
    channelComparison: [...group((r) => r.channel).entries()].map(([name, xs]) => ({ name, marginPct: avgMargin(xs), contributionCents: Number(mean(xs.map((x) => new D(x.contributionCents!)))?.split('.')[0] ?? 0), items: distinct(xs.map((x) => x.itemId)) })).sort((a, b) => b.marginPct - a.marginPct),
    composition: ev.length ? [
      { name: 'Custo variável', pct: pctOf(sum((r) => r.evaluation!.variableCostCents)) },
      { name: 'Taxas e tributos informados', pct: pctOf(sum((r) => r.evaluation!.totalFeesCents)) },
      { name: 'Contribuição', pct: pctOf(sum((r) => r.evaluation!.contributionCents)) },
    ] : [],
    biggestGaps: gapRows.map(({ r, gap }) => ({ name: label(r), gapPp: gap.toDecimalPlaces(2).toNumber() })),
    lowestMargins: [...ev].sort((a, b) => new D(a.marginPct!).cmp(b.marginPct!)).slice(0, 10).map((r) => ({ name: label(r), marginPct: Number(r.marginPct) })),
  };
}

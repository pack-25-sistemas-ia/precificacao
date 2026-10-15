import 'server-only';
import type { Context } from '@/lib/auth/session';
import { D, type Dec } from './engine';
import { analyzeRow, computeCharts, computeKpis, type AnalysisInput, type AnalysisRow } from './analysis-core';
import { loadCostVersions, loadEvents, loadScenarioItems, loadScenarios, loadScenarioVersions, rpc, type CostVersionRow, type EventRow, type PrSettings } from './data';
import type { Filters } from './filters';

const org = (ctx: Context) => ctx.membership.organization_id;

/** Item × canal com o motor: o banco resolve custo vigente, taxas e política; o servidor avalia e classifica. */
export async function loadAnalysis(ctx: Context, f: Pick<Filters, 'category' | 'channel' | 'type' | 'item' | 'risk' | 'policy'>, settings: Pick<PrSettings, 'price_review_days'>): Promise<AnalysisRow[]> {
  const inputs = await rpc<AnalysisInput[]>(ctx, 'pr_analysis_inputs', { p_org: org(ctx), p_category: f.category, p_channel: f.channel, p_item_type: f.type, p_item: f.item, p_limit: 2000 });
  let rows = inputs.map((i) => analyzeRow(i, settings.price_review_days));
  if (f.risk) rows = rows.filter((r) => r.risk.state === f.risk);
  if (f.policy) { const byPolicy = new Map(inputs.map((i) => [`${i.item_id}|${i.channel_id}`, i.policy.policy_id])); rows = rows.filter((r) => byPolicy.get(`${r.itemId}|${r.channelId}`) === f.policy); }
  return rows;
}

export function monthKey(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

/** Variação mensal média de custo: só versões que têm versão anterior do mesmo item, no período. */
export function costSeries(versions: CostVersionRow[], from: string, to: string, tz: string): Array<{ month: string; avgChangePct: number; versions: number }> {
  const byItem = new Map<string, CostVersionRow[]>();
  for (const v of versions) (byItem.get(v.item_id) ?? byItem.set(v.item_id, []).get(v.item_id)!).push(v);
  const buckets = new Map<string, Dec[]>();
  for (const list of byItem.values()) {
    list.sort((a, b) => a.version_number - b.version_number);
    for (let i = 1; i < list.length; i++) {
      const prev = new D(list[i - 1]!.direct_unit_cost_cents);
      if (prev.lte(0)) continue;
      const day = list[i]!.created_at.slice(0, 10);
      if (day < from || day > to) continue;
      const key = monthKey(list[i]!.created_at, tz);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(new D(list[i]!.direct_unit_cost_cents).minus(prev).div(prev).mul(100));
    }
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, xs]) => ({ month, avgChangePct: xs.reduce((s, x) => s.plus(x), new D(0)).div(xs.length).toDecimalPlaces(2).toNumber(), versions: xs.length }));
}

/** Preços publicados por mês: quantidade e variação média (novo × anterior, só quando havia preço anterior). */
export function priceSeries(events: EventRow[], tz: string): Array<{ month: string; count: number; avgChangePct: number | null }> {
  const buckets = new Map<string, { n: number; ch: Dec[] }>();
  for (const e of events) {
    const key = monthKey(e.effective_at, tz);
    const b = buckets.get(key) ?? buckets.set(key, { n: 0, ch: [] }).get(key)!;
    b.n++;
    if (e.previous_price_cents && e.previous_price_cents > 0) b.ch.push(new D(e.new_price_cents).minus(e.previous_price_cents).div(e.previous_price_cents).mul(100));
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, count: b.n, avgChangePct: b.ch.length ? b.ch.reduce((s, x) => s.plus(x), new D(0)).div(b.ch.length).toDecimalPlaces(2).toNumber() : null }));
}

export async function loadDashboard(ctx: Context, f: Filters, settings: PrSettings) {
  const [rows, events, versions, scenarios] = await Promise.all([
    loadAnalysis(ctx, f, settings),
    loadEvents(ctx, { from: `${f.from}T00:00:00Z`, to: `${f.to}T23:59:59Z`, limit: 5000 }),
    loadCostVersions(ctx),
    loadScenarios(ctx),
  ]);
  const sVersions = scenarios.length ? await loadScenarioVersions(ctx, scenarios.map((s) => s.id)) : [];
  const latest = new Map<string, (typeof sVersions)[number]>();
  for (const v of sVersions) { const cur = latest.get(v.scenario_id); if (!cur || v.version_number > cur.version_number) latest.set(v.scenario_id, v); }
  const sItems = await loadScenarioItems(ctx, [...latest.values()].map((v) => v.id));
  const scenarioCompare = scenarios.map((s) => {
    const v = latest.get(s.id);
    const items = v ? sItems.filter((i) => i.scenario_version_id === v.id) : [];
    const margins = items.map((i) => i.margin_decimal).filter((m): m is number => m !== null);
    return { name: s.name, marginPct: margins.length ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(2)) : 0, viable: items.filter((i) => i.viable).length, total: items.length, version: v?.version_number ?? 0 };
  }).filter((s) => s.total > 0).slice(0, 8);
  return {
    rows, kpis: computeKpis(rows), charts: computeCharts(rows),
    pricesChanged: events.length, scenariosSaved: scenarios.length, scenarioCompare,
    costSeries: costSeries(versions, f.from, f.to, settings.timezone), priceSeries: priceSeries(events, settings.timezone),
  };
}

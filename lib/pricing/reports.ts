import 'server-only';
import type { Context } from '@/lib/auth/session';
import { loadAnalysis } from './analysis';
import { toCsv, type CsvValue } from './csv';
import {
  loadAllComponents, loadCategories, loadChannels, loadCostVersions, loadEvents, loadFeeRules, loadItems, loadListItems, loadListVersions, loadMemberNames, loadPriceLists, loadRequests,
  loadScenarioItems, loadScenarios, loadScenarioVersions, type PrSettings,
} from './data';
import { formatDateBR } from './dates';
import { D, summarizeCosts, type CostComponentInput, type CostKind } from './engine';
import type { Filters } from './filters';
import { COST_TYPE_LABELS, FEE_BASIS_LABELS, FEE_KIND_LABELS, ITEM_TYPE_LABELS, LIST_STATUS_LABELS, REQUEST_STATUS_LABELS, ROUNDING_LABELS, SOURCE_LABELS } from './labels';
import { formatBRL } from './money';
import { categoryLabel } from './page';
import type { AnalysisRow } from './analysis-core';

// Relatórios: o mesmo conteúdo aparece na tela e no CSV. Cada célula traz o texto de exibição (d) e o valor do CSV (v).
export type Cell = { d: string; v: CsvValue };
export type Report = { name: string; title: string; description: string; head: string[]; rows: Cell[][]; truncated: boolean };

const txt = (s: string | null | undefined): Cell => ({ d: s ?? '—', v: s ?? '' });
const brl = (cents: number | null | undefined): Cell => (cents === null || cents === undefined ? { d: '—', v: '' } : { d: formatBRL(cents), v: { num: (cents / 100).toFixed(2).replace('.', ',') } });
const unitBrl = (c: string | number | null | undefined): Cell => {
  if (c === null || c === undefined || c === '') return { d: '—', v: '' };
  const reais = new D(c).div(100);
  return { d: reais.toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }), v: { num: reais.toFixed(4).replace('.', ',') } };
};
const pct = (p: string | number | null | undefined): Cell => (p === null || p === undefined || p === '' ? { d: '—', v: '' } : { d: `${new D(p).toDecimalPlaces(2).toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 2 })} %`, v: { num: new D(p).toFixed(2).replace('.', ',') } });
const int = (n: number | null | undefined): Cell => (n === null || n === undefined ? { d: '—', v: '' } : { d: String(n), v: n });
const date = (s: string | null | undefined): Cell => (s ? { d: formatDateBR(s.slice(0, 10)), v: s.slice(0, 10) } : { d: '—', v: '' });
const when = (s: string, tz: string): Cell => {
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s));
  return { d, v: d };
};

export const REPORTS: Array<{ name: string; title: string; description: string }> = [
  { name: 'itens', title: 'Produtos e serviços', description: 'Cadastro de itens com tipo, categoria, unidade, preço-base e situação.' },
  { name: 'composicao-custos', title: 'Composição de custos', description: 'Componentes do custo de cada item (rascunho atual), com custo unitário e participação no total.' },
  { name: 'precos-atuais', title: 'Preços atuais', description: 'Preço vigente por item e canal, com a origem (canal ou preço-base).' },
  { name: 'precos-recomendados', title: 'Preços recomendados', description: 'Preço de equilíbrio e preço para a margem-alvo (recomendação calculada, não é receita realizada).' },
  { name: 'margens-produto', title: 'Margens por produto ou serviço', description: 'Contribuição, margem e markup no preço atual, por item e canal.' },
  { name: 'margens-categoria', title: 'Margens por categoria', description: 'Média simples das margens por categoria (não é margem consolidada ponderada).' },
  { name: 'comparativo-canais', title: 'Comparativo por canal', description: 'Para cada item, o preço, a contribuição e a margem em cada canal.' },
  { name: 'taxas-comissoes', title: 'Taxas e comissões', description: 'Taxas cadastradas por canal, com base de incidência, percentuais, valores fixos e tetos. São valores informados, não vigentes oficiais.' },
  { name: 'abaixo-meta', title: 'Itens abaixo da meta', description: 'Margem abaixo da mínima da política aplicável.' },
  { name: 'contribuicao-negativa', title: 'Itens com contribuição negativa', description: 'Preço atual não cobre custo variável e taxas.' },
  { name: 'cenarios', title: 'Cenários', description: 'Última versão de cada cenário salvo, por item e canal.' },
  { name: 'historico-alteracoes', title: 'Histórico de alterações de preço', description: 'Preços publicados (solicitações e listas), com preço anterior e novo.' },
  { name: 'listas-precos', title: 'Listas de preços', description: 'Versões das listas, situação, vigência e quantidade de itens.' },
  { name: 'variacao-custos', title: 'Variações de custo', description: 'Custo direto unitário na última versão comparado à anterior.' },
  { name: 'alteracoes-aprovadas', title: 'Alterações aprovadas', description: 'Solicitações de preço aprovadas ou publicadas, com quem aprovou.' },
  { name: 'proximos-minima', title: 'Preços próximos da margem mínima', description: 'Itens cuja margem está até a faixa configurada acima da mínima.' },
  { name: 'simulacoes-desconto', title: 'Simulações de desconto', description: 'Itens de cenários salvos com desconto, com a contribuição resultante.' },
];
export const REPORT_NAMES = REPORTS.map((r) => r.name);
const MAX_ROWS = 5000;


function marginRow(r: AnalysisRow): Cell[] {
  const ev = r.evaluation;
  return [txt(r.sku), txt(r.name), txt(r.channel), brl(r.priceCents), unitBrl(r.directUnit), brl(ev?.totalFeesCents ?? null), brl(r.contributionCents), pct(r.marginPct), pct(ev?.markupPct ?? null), txt(r.risk.label)];
}
const MARGIN_HEAD = ['SKU', 'Item', 'Canal', 'Preço atual', 'Custo direto unitário', 'Taxas', 'Contribuição', 'Margem de contribuição', 'Markup', 'Situação'];

export async function buildReport(ctx: Context, settings: PrSettings, name: string, f: Filters): Promise<Report | null> {
  const meta = REPORTS.find((r) => r.name === name);
  if (!meta) return null;
  const tz = settings.timezone;
  const base = { name, title: meta.title, description: meta.description };
  const done = (head: string[], rows: Cell[][]): Report => ({ ...base, head, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS });
  const analysis = () => loadAnalysis(ctx, { ...f, risk: null, policy: null }, settings);
  const names = new Map((await loadMemberNames(ctx)).map((m) => [m.user_id, m.display_name]));
  const who = (id: string | null) => txt(id ? names.get(id) ?? 'ex-membro' : null);

  switch (name) {
    case 'itens': {
      const [{ rows }, cats] = await Promise.all([loadItems(ctx, { type: f.type, category: f.category, limit: MAX_ROWS + 1, status: null }), loadCategories(ctx)]);
      const byCat = new Map(cats.map((c) => [c.id, categoryLabel(cats, c)]));
      return done(['SKU', 'Nome', 'Tipo', 'Categoria', 'Unidade', 'Preço-base', 'Situação'], rows.map((i) => [txt(i.sku), txt(i.name), txt(ITEM_TYPE_LABELS[i.item_type]), txt(i.category_id ? byCat.get(i.category_id) : null), txt(i.unit), brl(i.current_base_price_cents), txt(i.status === 'active' ? 'Ativo' : 'Inativo')]));
    }
    case 'composicao-custos': {
      const [{ rows: items }, comps, versions] = await Promise.all([loadItems(ctx, { type: f.type, category: f.category, limit: MAX_ROWS + 1, status: 'active' }), loadAllComponents(ctx), loadCostVersions(ctx)]);
      const latest = new Map<string, number>();
      for (const v of versions) if (!latest.has(v.item_id)) latest.set(v.item_id, v.version_number);
      const out: Cell[][] = [];
      for (const it of items) {
        if (f.item && it.id !== f.item) continue;
        const mine: CostComponentInput[] = comps.filter((c) => c.item_id === it.id).map((c) => ({ id: c.id, kind: c.cost_type as CostKind, costClass: c.cost_class, name: c.name, amountCents: c.amount_cents, quantity: c.quantity, usage: c.usage, allocationMethod: c.allocation_method as never, active: c.active }));
        const s = summarizeCosts(mine);
        for (const c of comps.filter((x) => x.item_id === it.id)) {
          const line = s.lines.find((l) => l.id === c.id);
          out.push([txt(it.sku), txt(it.name), txt(c.name), txt(COST_TYPE_LABELS[c.cost_type as keyof typeof COST_TYPE_LABELS] ?? c.cost_type), txt(c.cost_class === 'direct' ? 'Direto' : 'Rateio'), unitBrl(line?.unitCents ?? null), pct(line?.sharePct ?? null), txt(c.active ? 'Ativo' : 'Inativo'), txt(c.amount_cents === null ? 'Desconhecido' : 'Informado'), int(latest.get(it.id) ?? null)]);
        }
      }
      return done(['SKU', 'Item', 'Componente', 'Tipo', 'Classe', 'Custo unitário', 'Participação', 'Situação', 'Valor', 'Última versão salva'], out);
    }
    case 'precos-atuais': return done(['SKU', 'Item', 'Canal', 'Preço atual', 'Origem do preço'], (await analysis()).map((r) => [txt(r.sku), txt(r.name), txt(r.channel), brl(r.priceCents), txt(r.priceSource === 'channel' ? 'Preço do canal' : r.priceSource === 'base' ? 'Preço-base' : 'Sem preço')]));
    case 'precos-recomendados': return done(['SKU', 'Item', 'Canal', 'Preço atual', 'Preço de equilíbrio', 'Preço para a margem-alvo', 'Margem-alvo', 'Diferença atual × alvo', 'Arredondamento', 'Observação'],
      (await analysis()).map((r) => [txt(r.sku), txt(r.name), txt(r.channel), brl(r.priceCents), brl(r.equilibriumPriceCents), brl(r.targetPriceCents), pct(r.targetMarginPct), pct(r.priceGapPct), txt(ROUNDING_LABELS[r.rounding]),
        txt(!r.hasVersion ? 'Sem versão de custo' : r.target?.status === 'inviable' ? 'Inviável: taxas + margem ≥ 100 %' : r.target?.status === 'unresolvable' ? 'Não resolvível com segurança' : r.target?.status === 'ok' && !r.target.meetsTarget ? `Arredondamento deixa ${r.target.shortfallPp} p.p. abaixo da meta` : '')]));
    case 'margens-produto': return done(MARGIN_HEAD, (await analysis()).map(marginRow));
    case 'margens-categoria': {
      const groups = new Map<string, AnalysisRow[]>();
      for (const r of (await analysis()).filter((x) => x.marginPct !== null)) (groups.get(r.category) ?? groups.set(r.category, []).get(r.category)!).push(r);
      return done(['Categoria', 'Itens × canais', 'Margem média simples', 'Menor margem', 'Maior margem'], [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([cat, rs]) => {
        const ms = rs.map((r) => new D(r.marginPct!));
        const avg = ms.reduce((s, x) => s.plus(x), new D(0)).div(ms.length);
        return [txt(cat), int(rs.length), pct(avg.toFixed(4)), pct(D.min(...ms).toFixed(4)), pct(D.max(...ms).toFixed(4))];
      }));
    }
    case 'comparativo-canais': return done(['SKU', 'Item', 'Canal', 'Preço', 'Taxas', 'Contribuição', 'Margem', 'Preço para a meta', 'Diferença para o preço atual'],
      (await analysis()).filter((r) => r.priceCents !== null).sort((a, b) => a.sku.localeCompare(b.sku) || a.channel.localeCompare(b.channel)).map((r) => [txt(r.sku), txt(r.name), txt(r.channel), brl(r.priceCents), brl(r.evaluation?.totalFeesCents ?? null), brl(r.contributionCents), pct(r.marginPct), brl(r.targetPriceCents), pct(r.priceGapPct)]));
    case 'taxas-comissoes': {
      const [rules, channels] = await Promise.all([loadFeeRules(ctx), loadChannels(ctx)]);
      const ch = new Map(channels.map((c) => [c.id, c.name]));
      return done(['Canal', 'Taxa', 'Tipo', 'Base', 'Percentual', 'Valor fixo', 'Mínimo', 'Teto', 'Vigência', 'Situação'], rules.filter((r) => !f.channel || r.channel_id === f.channel).map((r) => [txt(ch.get(r.channel_id)), txt(r.name), txt(FEE_KIND_LABELS[r.fee_type as keyof typeof FEE_KIND_LABELS] ?? r.fee_type), txt(FEE_BASIS_LABELS[r.basis as keyof typeof FEE_BASIS_LABELS] ?? r.basis),
        pct(r.rate_decimal), unitBrl(r.fixed_amount_cents), unitBrl(r.minimum_amount_cents), unitBrl(r.maximum_amount_cents), txt(`${r.valid_from ? formatDateBR(r.valid_from) : 'sempre'} → ${r.valid_until ? formatDateBR(r.valid_until) : 'sem fim'}`), txt(r.active ? 'Ativa' : 'Inativa')]));
    }
    case 'abaixo-meta': return done([...MARGIN_HEAD, 'Margem mínima'], (await analysis()).filter((r) => r.risk.state === 'below_target').map((r) => [...marginRow(r), pct(r.minimumMarginPct)]));
    case 'contribuicao-negativa': return done(MARGIN_HEAD, (await analysis()).filter((r) => r.risk.state === 'negative_contribution').map(marginRow));
    case 'proximos-minima': {
      const near = new D(settings.near_minimum_margin_pp);
      return done([...MARGIN_HEAD, 'Margem mínima'], (await analysis()).filter((r) => r.marginPct !== null && new D(r.marginPct).gte(r.minimumMarginPct) && new D(r.marginPct).lte(new D(r.minimumMarginPct).plus(near))).map((r) => [...marginRow(r), pct(r.minimumMarginPct)]));
    }
    case 'cenarios':
    case 'simulacoes-desconto': {
      const [scenarios, items, channels] = await Promise.all([loadScenarios(ctx), loadItems(ctx, { limit: 5000 }), loadChannels(ctx)]);
      const versions = scenarios.length ? await loadScenarioVersions(ctx, scenarios.map((s) => s.id)) : [];
      const latest = new Map<string, (typeof versions)[number]>();
      for (const v of versions) { const c = latest.get(v.scenario_id); if (!c || v.version_number > c.version_number) latest.set(v.scenario_id, v); }
      const si = await loadScenarioItems(ctx, [...latest.values()].map((v) => v.id));
      const it = new Map(items.rows.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name]));
      const out: Cell[][] = [];
      for (const s of scenarios) {
        const v = latest.get(s.id); if (!v) continue;
        for (const x of si.filter((i) => i.scenario_version_id === v.id)) {
          const ov = (v.input_snapshot_json.items.find((e) => e.item_id === x.pricing_item_id && e.channel_id === x.channel_id)?.overrides ?? {}) as Record<string, number>;
          if (name === 'simulacoes-desconto' && !(Number(ov.discount_pct) > 0)) continue;
          out.push([txt(s.name), int(v.version_number), txt(it.get(x.pricing_item_id)?.sku), txt(it.get(x.pricing_item_id)?.name), txt(ch.get(x.channel_id)), pct(ov.discount_pct ?? 0), brl(x.input_price_cents), brl(x.direct_cost_cents), brl(x.fees_cents), brl(x.contribution_cents), pct(x.margin_decimal), brl(x.suggested_price_cents), txt(x.viable ? 'Viável' : 'Fora da política')]);
        }
      }
      return done(['Cenário', 'Versão', 'SKU', 'Item', 'Canal', 'Desconto', 'Preço do cenário', 'Custo variável', 'Taxas', 'Contribuição', 'Margem', 'Preço sugerido', 'Situação'], out);
    }
    case 'historico-alteracoes': {
      const [events, items, channels] = await Promise.all([loadEvents(ctx, { from: `${f.from}T00:00:00Z`, to: `${f.to}T23:59:59Z`, itemId: f.item ?? undefined }), loadItems(ctx, { limit: 5000 }), loadChannels(ctx)]);
      const it = new Map(items.rows.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name]));
      return done(['Quando', 'SKU', 'Item', 'Canal', 'Preço anterior', 'Novo preço', 'Variação', 'Origem', 'Responsável'], events.map((e) => [when(e.effective_at, tz), txt(it.get(e.item_id)?.sku), txt(it.get(e.item_id)?.name), txt(e.channel_id ? ch.get(e.channel_id) : 'Preço-base'), brl(e.previous_price_cents), brl(e.new_price_cents),
        pct(e.previous_price_cents ? new D(e.new_price_cents).minus(e.previous_price_cents).div(e.previous_price_cents).mul(100).toFixed(4) : null), txt(e.list_version_id ? 'Lista de preços' : 'Solicitação'), who(e.created_by)]));
    }
    case 'listas-precos': {
      const [lists, versions, channels] = await Promise.all([loadPriceLists(ctx), loadListVersions(ctx), loadChannels(ctx)]);
      const ch = new Map(channels.map((c) => [c.id, c.name]));
      const out: Cell[][] = [];
      for (const v of versions) {
        const l = lists.find((x) => x.id === v.price_list_id); if (!l) continue;
        const n = (await loadListItems(ctx, v.id)).length;
        out.push([txt(l.name), txt(l.channel_id ? ch.get(l.channel_id) : 'Todos os canais'), int(v.version_number), txt(LIST_STATUS_LABELS[v.status] ?? v.status), date(v.valid_from), date(v.valid_until), int(n), v.published_at ? when(v.published_at, tz) : txt(null)]);
      }
      return done(['Lista', 'Canal', 'Versão', 'Situação', 'Vigência (início)', 'Vigência (fim)', 'Itens', 'Publicada em'], out);
    }
    case 'variacao-custos': {
      const [versions, items] = await Promise.all([loadCostVersions(ctx), loadItems(ctx, { type: f.type, category: f.category, limit: 5000 })]);
      const it = new Map(items.rows.map((i) => [i.id, i]));
      const byItem = new Map<string, typeof versions>();
      for (const v of versions) (byItem.get(v.item_id) ?? byItem.set(v.item_id, []).get(v.item_id)!).push(v);
      const out: Cell[][] = [];
      for (const [id, vs] of byItem) {
        const item = it.get(id); if (!item || vs.length < 2 || (f.item && f.item !== id)) continue;
        const [cur, prev] = [vs[0]!, vs[1]!];
        out.push([txt(item.sku), txt(item.name), int(prev.version_number), unitBrl(prev.direct_unit_cost_cents), int(cur.version_number), unitBrl(cur.direct_unit_cost_cents), unitBrl(new D(cur.direct_unit_cost_cents).minus(prev.direct_unit_cost_cents).toFixed(6)),
          pct(new D(prev.direct_unit_cost_cents).gt(0) ? new D(cur.direct_unit_cost_cents).minus(prev.direct_unit_cost_cents).div(prev.direct_unit_cost_cents).mul(100).toFixed(4) : null), when(cur.created_at, tz)]);
      }
      return done(['SKU', 'Item', 'Versão anterior', 'Custo anterior', 'Versão atual', 'Custo atual', 'Diferença', 'Variação', 'Salva em'], out);
    }
    case 'alteracoes-aprovadas': {
      const [reqs, items, channels] = await Promise.all([loadRequests(ctx, { status: ['approved', 'published'], limit: 1000, itemId: f.item ?? undefined }), loadItems(ctx, { limit: 5000 }), loadChannels(ctx)]);
      const it = new Map(items.rows.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name]));
      return done(['Solicitada em', 'SKU', 'Item', 'Canal', 'Preço anterior', 'Preço proposto', 'Situação', 'Origem', 'Proposta por', 'Aprovada por', 'Publicada em'], reqs.map((r) => [when(r.requested_at, tz), txt(it.get(r.item_id)?.sku), txt(it.get(r.item_id)?.name), txt(r.channel_id ? ch.get(r.channel_id) : 'Preço-base'), brl(r.previous_price_cents), brl(r.proposed_price_cents),
        txt(REQUEST_STATUS_LABELS[r.status] ?? r.status), txt(SOURCE_LABELS[r.source] ?? r.source), who(r.requested_by), who(r.reviewed_by), r.published_at ? when(r.published_at, tz) : txt(null)]));
    }
    default: return null;
  }
}

export const reportToCsv = (r: Report) => toCsv(r.head, r.rows.map((row) => row.map((c) => c.v)));

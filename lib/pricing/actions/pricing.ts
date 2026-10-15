'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustPricing, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { solvePrice, D, ENGINE_VERSION, type FeeLine, type RoundingRule } from '../engine';
import { parseBRL } from '../money';
import { parseQty } from '../qty';
import { idSchema, listItemsSchema, listSchema, listVersionSchema, priceChangeSchema, reviewSchema, scenarioSchema } from '../schemas';
import type { Context } from '@/lib/auth/session';

// ---------------------------------------------------------------- alterações de preço (propor → aprovar → publicar)
export async function requestPriceChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(priceChangeSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'requestPriceChange', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('pr_request_price_change', { p_org: org, p_item: v.item_id, p_channel: v.channel_id, p_price: v.price, p_justification: v.justification, p_source: 'manual' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Proposta enviada para aprovação. O impacto foi calculado pelo banco e fica registrado com a proposta.');
  });
}

export async function reviewPriceChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reviewSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'reviewPriceChange', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_review_price_change', { p_org: org, p_request: p.data.id, p_approve: p.data.decision === 'approve', p_note: p.data.note });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(p.data.decision === 'approve' ? 'Alteração aprovada. Falta publicar.' : 'Alteração rejeitada.');
  });
}

export async function publishPriceChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'publishPriceChange', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_publish_price_change', { p_org: org, p_request: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Preço publicado neste sistema (nada é enviado a plataformas externas).');
  });
}

export async function cancelPriceChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'cancelPriceChange', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_cancel_price_change', { p_org: org, p_request: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Solicitação cancelada.');
  });
}

// ---------------------------------------------------------------- listas de preço
export async function createList(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(listSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createList', async (ctx, org) => {
    const { data, error } = await ctx.supabase.from('price_lists').insert({ organization_id: org, name: p.data.name, description: p.data.description, channel_id: p.data.channel_id }).select('id').single();
    if (error) return fail(dbMessage(error, 'Já existe uma lista com este nome.'), undefined, raw);
    bustPricing();
    return { ...succeed('Lista criada. Agora crie a primeira revisão.'), id: data.id as string, redirectTo: `/listas-precos/${data.id as string}` };
  });
}

export async function createListVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(listVersionSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createListVersion', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('pr_create_list_version', { p_org: org, p_list: v.list_id, p_valid_from: v.valid_from, p_valid_until: v.valid_until, p_note: v.note, p_copy_from: v.copy_from });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Revisão criada em rascunho.');
  });
}

/** Linhas «SKU;preço;qtd mínima;qtd máxima» → itens da versão. Erros por linha, em português. */
async function parseListLines(ctx: Context, org: string, text: string): Promise<{ items: Array<Record<string, unknown>>; errors: string[] }> {
  const errors: string[] = [];
  const parsed: Array<{ sku: string; price: number; min: string | null; max: string | null; n: number }> = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;
    const [sku = '', price = '', min = '', max = ''] = l.split(/;|\t/).map((x) => x.trim());
    const cents = parseBRL(price);
    if (!sku || cents === null || cents <= 0) { errors.push(`Linha ${idx + 1}: use «SKU;preço» (ex.: P1;30,00).`); return; }
    const mn = min ? parseQty(min, 6, { allowZero: true }) : null; const mx = max ? parseQty(max, 6) : null;
    if ((min && mn === null) || (max && mx === null)) { errors.push(`Linha ${idx + 1}: quantidades inválidas.`); return; }
    parsed.push({ sku, price: cents, min: mn, max: mx, n: idx + 1 });
  });
  if (errors.length || !parsed.length) return { items: [], errors: errors.length ? errors : ['Informe ao menos uma linha.'] };
  const { data, error } = await ctx.supabase.from('pricing_items').select('id, sku').eq('organization_id', org).is('archived_at', null).in('sku', [...new Set(parsed.map((x) => x.sku))].slice(0, 1000));
  if (error) throw new Error('consulta falhou');
  const bySku = new Map((data ?? []).map((r) => [String(r.sku).toLowerCase(), String(r.id)]));
  const items: Array<Record<string, unknown>> = [];
  for (const x of parsed) {
    const id = bySku.get(x.sku.toLowerCase());
    if (!id) { errors.push(`Linha ${x.n}: SKU «${x.sku}» não cadastrado.`); continue; }
    items.push({ item_id: id, price_cents: x.price, min_qty: x.min, max_qty: x.max });
  }
  return { items, errors };
}

export async function setListItems(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(listItemsSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'setListItems', async (ctx, org) => {
    const r = await parseListLines(ctx, org, p.data.lines);
    if (r.errors.length) return fail(r.errors.slice(0, 6).join(' '), { lines: r.errors.slice(0, 6) }, raw);
    const { data, error } = await ctx.supabase.rpc('pr_set_list_items', { p_org: org, p_version: p.data.version_id, p_items: r.items });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(`${String(data)} item(ns) gravado(s) no rascunho.`);
  });
}

const listStep = (name: string, fn: string, msg: string, level: 'operator' | 'manager') => async (_: ActionState, fd: FormData): Promise<ActionState> => {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded(level, name, async (ctx, org) => {
    const { error } = await ctx.supabase.rpc(fn, { p_org: org, p_version: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(msg);
  });
};
export async function submitListVersion(prev: ActionState, fd: FormData) { return listStep('submitListVersion', 'pr_submit_list_version', 'Lista enviada para aprovação.', 'operator')(prev, fd); }
export async function withdrawListVersion(prev: ActionState, fd: FormData) { return listStep('withdrawListVersion', 'pr_withdraw_list_version', 'Revisão retirada da fila (voltou a rascunho).', 'operator')(prev, fd); }
export async function discardListVersion(prev: ActionState, fd: FormData) { return listStep('discardListVersion', 'pr_discard_list_version', 'Rascunho descartado.', 'operator')(prev, fd); }
export async function publishListVersion(prev: ActionState, fd: FormData) { return listStep('publishListVersion', 'pr_publish_list_version', 'Lista publicada neste sistema (nada é enviado a plataformas externas).', 'manager')(prev, fd); }
export async function retireListVersion(prev: ActionState, fd: FormData) { return listStep('retireListVersion', 'pr_retire_list_version', 'Versão descontinuada (continua no histórico).', 'manager')(prev, fd); }

export async function reviewListVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(reviewSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'reviewListVersion', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_review_list_version', { p_org: org, p_version: p.data.id, p_approve: p.data.decision === 'approve', p_note: p.data.note });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(p.data.decision === 'approve' ? 'Lista aprovada. Falta publicar.' : 'Lista rejeitada.');
  });
}

// ---------------------------------------------------------------- cenários
type CtxJson = { cost: { direct_unit_cents: number; overhead_unit_cents: number | null } | null; fees: Array<Record<string, unknown>>; policy: { rules: { target_margin_pct: number; rounding: string; min_price_cents: number | null } } };

/** O navegador NUNCA decide a sugestão: o servidor calcula com o motor e o banco confere pela avaliação direta ao gravar. */
async function suggest(ctx: Context, org: string, it: { item_id: string; channel_id: string; cost_adjust_pct: number; extra_cost_cents: number; quantity: number; target_margin_pct?: number | null }): Promise<number | null> {
  const { data } = await ctx.supabase.rpc('pr_item_context', { p_org: org, p_item: it.item_id, p_channel: it.channel_id, p_date: null });
  const c = data as CtxJson | null;
  if (!c?.cost) return null;
  const fees: FeeLine[] = c.fees.map((f) => ({ id: String(f.id), name: String(f.name), kind: f.kind as FeeLine['kind'], basis: f.basis as FeeLine['basis'], ratePct: (f.rate_pct as number | null) ?? null, fixedCents: (f.fixed_cents as number | null) ?? null, minCents: (f.min_cents as number | null) ?? null, maxCents: (f.max_cents as number | null) ?? null }));
  const cost = new D(c.cost.direct_unit_cents).mul(new D(1).plus(new D(it.cost_adjust_pct).div(100))).plus(it.extra_cost_cents);
  try {
    const r = solvePrice({ variableUnitCost: cost, overheadUnit: c.cost.overhead_unit_cents, fees, quantity: it.quantity, targetMarginPct: it.target_margin_pct ?? c.policy.rules.target_margin_pct, rounding: c.policy.rules.rounding as RoundingRule, floorCents: c.policy.rules.min_price_cents });
    return r.status === 'ok' ? r.priceCents : null;
  } catch { return null; }
}

export async function saveScenario(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(scenarioSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveScenario', async (ctx, org) => {
    const v = p.data;
    const items: Array<Record<string, unknown>> = [];
    for (let i = 0; i < v.payload.length; i += 20) {
      const batch = v.payload.slice(i, i + 20);
      const sug = await Promise.all(batch.map((x) => suggest(ctx, org, x)));
      batch.forEach((x, k) => items.push({ item_id: x.item_id, channel_id: x.channel_id, price_cents: x.price_cents ?? null, quantity: x.quantity, cost_adjust_pct: x.cost_adjust_pct, extra_cost_cents: x.extra_cost_cents, discount_pct: x.discount_pct, target_margin_pct: x.target_margin_pct ?? null, suggested_price_cents: sug[k] }));
    }
    const { data, error } = await ctx.supabase.rpc('pr_save_scenario', { p_org: org, p_scenario: v.scenario_id, p_name: v.name, p_description: v.description, p_items: items, p_engine_version: ENGINE_VERSION });
    if (error) return fail(dbMessage(error, 'Já existe um cenário com este nome.'), undefined, raw);
    bustPricing();
    const r = data as { scenario_id: string; version_number: number };
    return { ...succeed(`Cenário salvo (versão ${r.version_number}). Os resultados foram recalculados e gravados pelo banco.`), id: r.scenario_id, redirectTo: `/cenarios/${r.scenario_id}` };
  });
}

export async function archiveScenario(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'archiveScenario', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_archive_scenario', { p_org: org, p_scenario: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Cenário arquivado (as versões continuam consultáveis).');
  });
}

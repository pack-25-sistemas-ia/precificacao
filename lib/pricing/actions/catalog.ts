'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustPricing, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import {
  TAX_SLOTS, archiveSchema, categoryEditSchema, categorySchema, channelEditSchema, channelSchema, feeRuleEditSchema, feeRuleSchema, itemEditSchema, itemSchema, settingsSchema, taxLineSchema, taxProfileSchema, uuid,
} from '../schemas';

// Cadastros: escrita direta pelo cliente do usuário (RLS + privilégios por coluna + gatilhos + MFA no banco decidem de novo). O preço atual NUNCA é gravável aqui.
const dupSku = 'Já existe um item com este SKU.';

export async function createCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categorySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createCategory', async (ctx, org) => {
    const { error } = await ctx.supabase.from('product_categories').insert({ organization_id: org, name: p.data.name, parent_id: p.data.parent_id, description: p.data.description });
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bustPricing();
    return succeed('Categoria criada.');
  });
}

export async function updateCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(categoryEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateCategory', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('product_categories').update({ name: v.name, description: v.description, parent_id: v.parent_id, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe uma categoria com este nome neste nível.'), undefined, raw);
    bustPricing();
    return succeed('Categoria atualizada.');
  });
}

export async function createItem(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(itemSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createItem', async (ctx, org) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.from('pricing_items').insert({ organization_id: org, sku: v.sku, name: v.name, item_type: v.item_type, category_id: v.category_id, unit: v.unit, description: v.description }).select('id').single();
    if (error) return fail(dbMessage(error, dupSku), undefined, raw);
    bustPricing();
    return { ...succeed(v.item_type === 'service' ? 'Serviço cadastrado.' : 'Produto cadastrado.'), id: data.id as string, redirectTo: `/${v.item_type === 'service' ? 'servicos' : 'produtos'}/${data.id as string}` };
  });
}

export async function updateItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(itemEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'updateItem', async (ctx, org) => {
    const v = p.data;
    const patch: Record<string, unknown> = { sku: v.sku, name: v.name, category_id: v.category_id, unit: v.unit, description: v.description };
    // analista não inativa (o gatilho também recusa); gestor sim
    if (ctx.membership.role !== 'member') patch.status = v.status;
    const { error } = await ctx.supabase.from('pricing_items').update(patch).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, dupSku), undefined, raw);
    bustPricing();
    return succeed('Cadastro atualizado. Versões de custo e preços publicados continuam intactos.');
  });
}

export async function setItemArchived(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(archiveSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'setItemArchived', async (ctx, org) => {
    const { error } = await ctx.supabase.from('pricing_items').update({ archived_at: p.data.archive === '1' ? new Date().toISOString() : null }).eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(p.data.archive === '1' ? 'Item arquivado (o histórico permanece).' : 'Item reativado.');
  });
}

export async function createChannel(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(channelSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createChannel', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('sales_channels').insert({ organization_id: org, name: v.name, channel_type: v.channel_type, description: v.description, tax_profile_id: v.tax_profile_id });
    if (error) return fail(dbMessage(error, 'Já existe um canal com este nome.'), undefined, raw);
    bustPricing();
    return succeed('Canal criado.');
  });
}

export async function updateChannel(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(channelEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateChannel', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('sales_channels').update({ name: v.name, channel_type: v.channel_type, description: v.description, tax_profile_id: v.tax_profile_id, active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error, 'Já existe um canal com este nome.'), undefined, raw);
    bustPricing();
    return succeed('Canal atualizado.');
  });
}

export async function createFeeRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(feeRuleSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createFeeRule', async (ctx, org) => {
    const v = p.data;
    const rateBasis = v.basis === 'price' || v.basis === 'net_price' || v.basis === 'cost';
    const { error } = await ctx.supabase.from('channel_fee_rules').insert({
      organization_id: org, channel_id: v.channel_id, name: v.name, fee_type: v.fee_type, basis: v.basis, rate_decimal: rateBasis ? Number(v.rate) : null, fixed_amount_cents: rateBasis ? null : v.fixed,
      minimum_amount_cents: rateBasis ? v.min : null, maximum_amount_cents: rateBasis ? v.max : null, priority: v.priority, valid_from: v.valid_from, valid_until: v.valid_until,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Taxa cadastrada. Ela vale para os próximos cálculos; cenários e versões já salvos não mudam.');
  });
}

export async function updateFeeRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(feeRuleEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateFeeRule', async (ctx, org) => {
    const { error } = await ctx.supabase.from('channel_fee_rules').update({ name: p.data.name, active: p.data.active }).eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Taxa atualizada.');
  });
}

/** Perfil tributário INFORMADO (D-P12): linhas «tax_<i>_name/rate/basis/source»; o banco recusa origem ausente e soma ≥ 100 %. */
function taxLines(raw: Record<string, string>) {
  const lines: Array<{ name: string; rate_pct: number; basis: string; source: string }> = [];
  const errors: Record<string, string[]> = {};
  for (let i = 0; i < TAX_SLOTS; i++) {
    const name = (raw[`tax_${i}_name`] ?? '').trim();
    const rate = (raw[`tax_${i}_rate`] ?? '').trim();
    if (!name && !rate) continue;
    const r = taxLineSchema.safeParse({ name, rate, basis: raw[`tax_${i}_basis`] ?? 'price', source: raw[`tax_${i}_source`] ?? '' });
    if (!r.success) { errors[`tax_${i}_name`] = [r.error.issues[0]?.message ?? 'Tributo inválido.']; continue; }
    lines.push({ name: r.data.name, rate_pct: Number(r.data.rate), basis: r.data.basis, source: r.data.source });
  }
  return { lines, errors };
}

export async function saveTaxProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(taxProfileSchema, raw, raw);
  if (!p.ok) return p.state;
  const t = taxLines(raw);
  if (Object.keys(t.errors).length) return fail('Revise os tributos destacados.', t.errors, raw);
  const idRaw = raw.id ? uuid.safeParse(raw.id) : null;
  if (idRaw && !idRaw.success) return fail('Perfil inválido.');
  return guarded('admin', 'saveTaxProfile', async (ctx, org) => {
    const cfg = { taxes: t.lines };
    const q = idRaw?.success
      ? ctx.supabase.from('tax_profiles').update({ name: p.data.name, description: p.data.description, configuration_json: cfg, active: raw.active !== 'off' }).eq('organization_id', org).eq('id', idRaw.data)
      : ctx.supabase.from('tax_profiles').insert({ organization_id: org, name: p.data.name, description: p.data.description, configuration_json: cfg });
    const { error } = await q;
    if (error) return fail(dbMessage(error, 'Já existe um perfil com este nome.'), undefined, raw);
    bustPricing();
    return succeed('Perfil tributário salvo. Lembre-se: são parâmetros informados por você; valide-os com seu contador.');
  });
}

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(settingsSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'saveSettings', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('pr_settings').update({
      default_target_margin_pct: Number(v.default_target_margin_pct), default_minimum_margin_pct: Number(v.default_minimum_margin_pct), default_rounding: v.default_rounding,
      price_review_days: v.price_review_days, near_minimum_margin_pp: Number(v.near_minimum_margin_pp), segregation_of_duties: v.segregation_of_duties,
    }).eq('organization_id', org);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Configurações salvas. Cenários e versões históricas não mudam.');
  });
}

'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustPricing, dbMessage, formObject, guarded, parse } from '../action-kit';
import { assignmentSchema, idSchema, policyEditSchema, policySchema } from '../schemas';

// Políticas são DADOS (margens, desconto máximo, arredondamento, preço mínimo): nada de código ou fórmula digitada. Publicar cria uma versão imutável.
const row = (v: { name: string; description: string | null; target: string; minimum: string; max_discount: string | null; rounding: string; min_price: number | null }) => ({
  name: v.name, description: v.description, target_margin_decimal: Number(v.target), minimum_margin_decimal: Number(v.minimum), max_discount_decimal: v.max_discount === null ? null : Number(v.max_discount), rounding_rule: v.rounding, min_price_cents: v.min_price,
});
const dupName = 'Já existe uma política com este nome.';

export async function createPolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(policySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createPolicy', async (ctx, org) => {
    const { error } = await ctx.supabase.from('pricing_policies').insert({ organization_id: org, ...row(p.data) });
    if (error) return fail(dbMessage(error, dupName), undefined, raw);
    bustPricing();
    return succeed('Política criada como rascunho. Publique para que ela passe a valer.');
  });
}

export async function updatePolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(policyEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'updatePolicy', async (ctx, org) => {
    const { error } = await ctx.supabase.from('pricing_policies').update(row(p.data)).eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error, dupName), undefined, raw);
    bustPricing();
    return succeed('Rascunho da política atualizado. Publique para criar uma nova versão; a versão vigente não muda até lá.');
  });
}

export async function publishPolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'publishPolicy', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('pr_publish_policy', { p_org: org, p_policy: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(`Política publicada (versão ${String(data)}).`);
  });
}

export async function retirePolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'retirePolicy', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_retire_policy', { p_org: org, p_policy: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Política aposentada (as versões continuam no histórico).');
  });
}

export async function createAssignment(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(assignmentSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'createAssignment', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('pricing_rule_assignments').insert({ organization_id: org, policy_id: v.policy_id, item_id: v.item_id, category_id: v.category_id, channel_id: v.channel_id, valid_from: v.valid_from, valid_until: v.valid_until });
    if (error) return fail(error.code === '23P01' ? 'Já existe uma atribuição vigente neste mesmo escopo e período: encerre ou ajuste a anterior para evitar conflito.' : dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Atribuição criada.');
  });
}

export async function deleteAssignment(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'deleteAssignment', async (ctx, org) => {
    const { error } = await ctx.supabase.from('pricing_rule_assignments').delete().eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Atribuição removida.');
  });
}

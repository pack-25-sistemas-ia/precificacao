'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustPricing, dbMessage, formObject, guarded, parse } from '../action-kit';
import { componentEditSchema, componentSchema, idSchema, saveVersionSchema } from '../schemas';

// Componentes = RASCUNHO do custo. «Salvar versão» grava o snapshot imutável (função pr_save_cost_version, que recusa custo incompleto).
export async function addComponent(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(componentSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'addComponent', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('cost_components').insert({
      organization_id: org, item_id: v.item_id, cost_class: v.cost_class, cost_type: v.cost_type, name: v.name, amount_cents: v.amount === null ? null : Number(v.amount),
      quantity: Number(v.quantity), usage: Number(v.usage), unit: v.unit, allocation_method: v.cost_class === 'overhead' ? v.allocation_method : null,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed(v.amount === null ? 'Componente adicionado SEM valor: fica como desconhecido (não zero) e impede salvar a versão.' : 'Componente adicionado ao rascunho do custo.');
  });
}

export async function updateComponent(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(componentEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'updateComponent', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.from('cost_components').update({ name: v.name, amount_cents: v.amount === null ? null : Number(v.amount), quantity: Number(v.quantity), usage: Number(v.usage), active: v.active }).eq('organization_id', org).eq('id', v.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Componente atualizado no rascunho. A versão salva não muda até você salvar uma nova.');
  });
}

export async function removeComponent(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'removeComponent', async (ctx, org) => {
    const { error } = await ctx.supabase.from('cost_components').delete().eq('organization_id', org).eq('id', p.data.id);
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Componente removido do rascunho (versões salvas continuam intactas).');
  });
}

export async function saveCostVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(saveVersionSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveCostVersion', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_save_cost_version', { p_org: org, p_item: p.data.item_id, p_note: p.data.note });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Versão de custo salva (imutável).');
  });
}

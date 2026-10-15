'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustPricing, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { idSchema, importSchema, uuid } from '../schemas';
import { z } from 'zod';

// Importação CSV: o navegador lê e normaliza; o BANCO valida cada linha (prévia) e só a confirmação grava, atomicamente. Preços importados viram propostas pendentes.
const levelFor = (type: string) => (type === 'items' || type === 'costs' || type === 'prices' ? 'operator' : 'manager') as 'operator' | 'manager';

export async function createImport(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(importSchema, raw);
  if (!p.ok) return p.state;
  return guarded(levelFor(p.data.type), 'createImport', async (ctx, org) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.rpc('pr_create_import', { p_org: org, p_type: v.type, p_file_name: v.file_name, p_hash: v.hash, p_rows: v.rows });
    if (error) return fail(dbMessage(error));
    const r = data as { duplicate_file?: boolean; import_id: string };
    if (r.duplicate_file) return { ...fail('Este arquivo já foi importado (ou está em prévia). Cancele a prévia anterior para reenviar.'), id: r.import_id, redirectTo: `/importacoes/${r.import_id}` };
    bustPricing();
    return { ...succeed('Prévia gerada. Nada foi gravado ainda: confira os números e confirme.'), id: r.import_id, redirectTo: `/importacoes/${r.import_id}` };
  });
}

export async function commitImport(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid, type: z.string().max(20) }), raw, raw);
  if (!p.ok) return p.state;
  return guarded(levelFor(p.data.type), 'commitImport', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('pr_commit_import', { p_org: org, p_job: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    const r = data as { already?: boolean; applied?: number };
    return succeed(r.already ? 'Esta importação já havia sido confirmada.' : `Importação concluída: ${r.applied ?? 0} linha(s) aplicada(s).${p.data.type === 'prices' ? ' Os preços viraram propostas aguardando aprovação.' : ''}`);
  });
}

export async function cancelImport(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid, type: z.string().max(20) }), raw, raw);
  if (!p.ok) return p.state;
  return guarded(levelFor(p.data.type), 'cancelImport', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_cancel_import', { p_org: org, p_job: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustPricing();
    return succeed('Prévia cancelada.');
  });
}

export async function markNotificationsRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema.partial(), raw);
  if (!p.ok) return p.state;
  return guarded('read', 'markNotificationsRead', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_mark_notifications_read', { p_org: org, p_ids: p.data.id ? [p.data.id] : null });
    if (error) return fail(dbMessage(error));
    bustPricing();
    return succeed('Avisos marcados como lidos.');
  });
}

export async function setNotificationPref(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ type: z.string().regex(/^[a-z_]{3,40}$/), enabled: z.enum(['1', '0']) }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('read', 'setNotificationPref', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('pr_set_notification_pref', { p_org: org, p_type: p.data.type, p_enabled: p.data.enabled === '1' });
    if (error) return fail(dbMessage(error));
    bustPricing();
    return succeed('Preferência salva.');
  });
}

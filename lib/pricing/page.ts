import 'server-only';
import { requireContext } from '@/lib/auth/session';
import { loadCategories, loadChannels, loadSettings, type CategoryRow, type ChannelRow } from './data';
import { todayIn } from './dates';
import { can } from './labels';

/** Contexto comum das páginas: sessão (já com MFA/papel), fuso da empresa, «hoje» e permissões para mostrar/ocultar botões (o banco decide de verdade). */
export async function pageCtx() {
  const ctx = await requireContext();
  const settings = await loadSettings(ctx);
  return { ctx, settings, tz: settings.timezone, today: todayIn(settings.timezone), perms: can(ctx.membership.role), org: ctx.membership.organization_id, role: ctx.membership.role };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;

export type Refs = { categories: CategoryRow[]; channels: ChannelRow[] };
export async function loadRefs(ctx: PageCtx['ctx']): Promise<Refs> {
  const [categories, channels] = await Promise.all([loadCategories(ctx), loadChannels(ctx)]);
  return { categories, channels };
}

/** «Pai › Filho» para listas de seleção. */
export function categoryLabel(cats: CategoryRow[], c: CategoryRow): string {
  const byId = new Map(cats.map((x) => [x.id, x]));
  const parts = [c.name];
  let cur = c.parent_id ? byId.get(c.parent_id) : undefined;
  let guard = 0;
  while (cur && guard++ < 5) { parts.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return parts.join(' › ');
}

export const categoryOpts = (cats: CategoryRow[]) => cats.filter((c) => c.active).map((c) => ({ value: c.id, label: categoryLabel(cats, c) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
export const channelOpts = (ch: ChannelRow[], includeInactive = false) => ch.filter((x) => includeInactive || x.active).map((x) => ({ value: x.id, label: x.name }));

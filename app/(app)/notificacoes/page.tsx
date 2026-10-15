import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { ActionButton } from '@/components/pricing/fields';
import { markNotificationsRead, setNotificationPref } from '@/lib/pricing/actions/imports';
import { loadNotificationPrefs, loadNotifications } from '@/lib/pricing/data';
import { NOTIFICATION_TYPES } from '@/lib/pricing/labels';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Avisos' };

const LINKS: Record<string, string> = { price_change_request: '/aprovacoes', price_list_version: '/listas-precos', import_job: '/importacoes', pricing_item: '/produtos' };

export default async function NotificationsPage() {
  const p = await pageCtx();
  const [list, prefs] = await Promise.all([loadNotifications(p.ctx, { limit: 100 }), loadNotificationPrefs(p.ctx)]);
  const off = new Set(prefs.filter((x) => !x.enabled).map((x) => x.type));
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Avisos" description="Avisos internos: aprovações pendentes, preços aprovados ou publicados, aumentos de custo e importações. Não dependem de e-mail.">
        {unread > 0 ? <ActionButton action={markNotificationsRead} fields={{}} label={`Marcar ${unread} como lido(s)`} /> : null}
      </PageHeader>
      <TableShell caption="Avisos" empty={list.length === 0} emptyText="Nenhum aviso por enquanto.">
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>Aviso</th><th scope="col" className={TH}>Quando</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH} /></tr></thead>
        <tbody>{list.map((n) => (
          <tr key={n.id} className="border-b border-border last:border-0 align-top">
            <td className={TD}><strong>{n.title}</strong>{n.body ? <span className="block text-sm text-muted">{n.body}</span> : null}{n.resource_type && LINKS[n.resource_type] ? <Link className="text-sm underline underline-offset-2" href={LINKS[n.resource_type]!}>abrir</Link> : null}</td>
            <td className={TD}><DateTimeBR value={n.created_at} tz={p.tz} /></td><td className={TD}>{n.read_at ? <Badge>Lido</Badge> : <Badge tone="warning">Novo</Badge>}</td>
            <td className={TD}>{!n.read_at ? <ActionButton action={markNotificationsRead} fields={{ id: n.id }} label="Marcar como lido" /> : null}</td>
          </tr>
        ))}</tbody>
      </TableShell>
      <Section title="Preferências" description="Escolha quais tipos de aviso você quer receber.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => (
            <li key={type} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span>{label}</span>
              <ActionButton action={setNotificationPref} fields={{ type, enabled: off.has(type) ? '1' : '0' }} label={off.has(type) ? 'Desativado — ativar' : 'Ativo — desativar'} />
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

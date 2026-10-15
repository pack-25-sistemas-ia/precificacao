import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Money, Pct, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { CancelRequestButton, PublishRequestButton, ReviewForm } from '@/components/pricing/price-forms';
import { loadChannels, loadItems, loadListVersions, loadMemberNames, loadPriceLists, loadRequests } from '@/lib/pricing/data';
import { D } from '@/lib/pricing/engine';
import { FLAG_LABELS, LIST_STATUS_LABELS, REQUEST_STATUS_LABELS, SOURCE_LABELS } from '@/lib/pricing/labels';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Aprovações' };

export default async function ApprovalsPage() {
  const p = await pageCtx();
  const [reqs, versions, lists, { rows: items }, channels, members] = await Promise.all([loadRequests(p.ctx, { limit: 300 }), loadListVersions(p.ctx), loadPriceLists(p.ctx), loadItems(p.ctx, { limit: 2000 }), loadChannels(p.ctx), loadMemberNames(p.ctx)]);
  const it = new Map(items.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name])); const who = new Map(members.map((m) => [m.user_id, m.display_name])); const ln = new Map(lists.map((l) => [l.id, l.name]));
  const open = reqs.filter((r) => r.status === 'pending' || r.status === 'approved');
  const done = reqs.filter((r) => !(r.status === 'pending' || r.status === 'approved')).slice(0, 40);
  const pendingLists = versions.filter((v) => v.status === 'pending' || v.status === 'approved');
  return (
    <>
      <PageHeader title="Aprovações de preço" description="Fluxo: o analista propõe → o sistema calcula o impacto → o gestor aprova ou rejeita → um gestor publica. Quem propôs não aprova a própria alteração (segregação). Publicar altera o preço neste sistema; nada é enviado a plataformas externas." />
      {p.settings.segregation_of_duties ? null : <Alert tone="warning">A segregação de funções está desligada nas configurações: quem propõe pode aprovar a própria alteração.</Alert>}

      <Section title="Alterações de preço em andamento">
        <TableShell caption="Alterações de preço em andamento" empty={open.length === 0} emptyText="Nenhuma alteração aguardando decisão ou publicação.">
          <thead><tr className="border-b border-border">{['Item', 'Canal', 'Preço', 'Impacto calculado', 'Justificativa', 'Situação', 'Ações'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
          <tbody>{open.map((r) => {
            const ev = r.impact_json.check?.evaluation as { margin_pct?: string | null; contribution_cents?: number } | undefined;
            const flags = r.impact_json.check?.flags ?? [];
            const change = r.previous_price_cents ? new D(r.proposed_price_cents).minus(r.previous_price_cents).div(r.previous_price_cents).mul(100).toFixed(2) : null;
            const mine = r.requested_by === p.ctx.user.id;
            return (
              <tr key={r.id} className="border-b border-border last:border-0 align-top">
                <td className={TD}>{it.get(r.item_id)?.sku} <span className="text-muted">{it.get(r.item_id)?.name}</span><span className="block text-xs text-muted">por {who.get(r.requested_by) ?? '—'} · {SOURCE_LABELS[r.source]} · <DateTimeBR value={r.requested_at} tz={p.tz} /></span></td>
                <td className={TD}>{r.channel_id ? ch.get(r.channel_id) : 'Preço-base'}</td>
                <td className={TD}><Money cents={r.previous_price_cents} /> → <strong><Money cents={r.proposed_price_cents} /></strong>{change ? <span className="block text-xs text-muted"><Pct value={change} signed /></span> : null}</td>
                <td className={TD}>margem <Pct value={ev?.margin_pct ?? null} /> · contribuição <Money cents={ev?.contribution_cents ?? null} />{flags.length ? <span className="mt-1 flex flex-wrap gap-1">{flags.map((f) => <Badge key={f} tone="danger">{FLAG_LABELS[f] ?? f}</Badge>)}</span> : <span className="block text-xs text-success">dentro das regras na proposta</span>}</td>
                <td className={`${TD} max-w-xs text-xs`}>{r.justification}{r.review_note ? <span className="block text-muted">Decisão: {r.review_note}</span> : null}</td>
                <td className={TD}><Badge tone={r.status === 'approved' ? 'success' : 'warning'}>{REQUEST_STATUS_LABELS[r.status]}</Badge>{r.reviewed_by ? <span className="block text-xs text-muted">por {who.get(r.reviewed_by) ?? '—'}</span> : null}</td>
                <td className={TD}>
                  <div className="flex flex-col gap-2">
                    {r.status === 'pending' && p.perms.manager ? (mine && p.settings.segregation_of_duties ? <span className="text-xs text-muted">Você propôs: outra pessoa precisa aprovar.</span> : <ReviewForm id={r.id} kind="price" />) : null}
                    {r.status === 'approved' && p.perms.manager ? <PublishRequestButton id={r.id} /> : null}
                    {p.perms.analyst && (mine || p.perms.manager) ? <CancelRequestButton id={r.id} /> : null}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>

      <Section title="Listas de preços em andamento" description="Revisões enviadas ou aprovadas e ainda não publicadas.">
        <TableShell caption="Listas de preços em andamento" empty={pendingLists.length === 0} emptyText="Nenhuma lista aguardando aprovação ou publicação.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Lista</th><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Enviada por</th><th scope="col" className={TH} /></tr></thead>
          <tbody>{pendingLists.map((v) => <tr key={v.id} className="border-b border-border last:border-0"><td className={TD}>{ln.get(v.price_list_id)}</td><td className={TD}>v{v.version_number}</td><td className={TD}><Badge tone="warning">{LIST_STATUS_LABELS[v.status]}</Badge></td><td className={TD}>{who.get(v.submitted_by ?? '') ?? '—'}</td><td className={TD}><Link className="underline underline-offset-2" href={`/listas-precos/${v.price_list_id}`}>abrir</Link></td></tr>)}</tbody>
        </TableShell>
      </Section>

      <Section title="Histórico recente" description="Últimas solicitações concluídas, rejeitadas ou canceladas. Nada aqui é apagado.">
        <TableShell caption="Histórico de solicitações" empty={done.length === 0} emptyText="Sem histórico ainda.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Item</th><th scope="col" className={TH}>Canal</th><th scope="col" className={TH}>Preço</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Decisão</th><th scope="col" className={TH}>Quando</th></tr></thead>
          <tbody>{done.map((r) => <tr key={r.id} className="border-b border-border last:border-0 align-top"><td className={TD}>{it.get(r.item_id)?.sku}</td><td className={TD}>{r.channel_id ? ch.get(r.channel_id) : 'Preço-base'}</td><td className={TD}><Money cents={r.previous_price_cents} /> → <Money cents={r.proposed_price_cents} /></td><td className={TD}><Badge tone={r.status === 'published' ? 'success' : 'neutral'}>{REQUEST_STATUS_LABELS[r.status]}</Badge></td><td className={`${TD} text-xs`}>{who.get(r.reviewed_by ?? '') ?? '—'}{r.review_note ? ` — ${r.review_note}` : ''}</td><td className={TD}><DateTimeBR value={r.published_at ?? r.reviewed_at ?? r.requested_at} tz={p.tz} /></td></tr>)}</tbody>
        </TableShell>
      </Section>
    </>
  );
}

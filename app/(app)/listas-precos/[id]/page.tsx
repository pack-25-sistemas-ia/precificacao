import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Disclosure, Money, Pct, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { ListItemsForm, ListVersionButtons, ListVersionForm, ReviewForm } from '@/components/pricing/price-forms';
import { loadItems, loadListItems, loadListVersions, loadMemberNames, loadPriceLists, rpc } from '@/lib/pricing/data';
import { FLAG_LABELS, LIST_STATUS_LABELS } from '@/lib/pricing/labels';
import { loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Lista de preços' };
type Problem = { item_id: string; sku: string; price_cents: number; flags: string[]; margin_pct?: number | null; contribution_cents?: number | null };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await pageCtx();
  const [refs, lists, versions, { rows: items }, members] = await Promise.all([loadRefs(p.ctx), loadPriceLists(p.ctx), loadListVersions(p.ctx, id), loadItems(p.ctx, { limit: 2000 }), loadMemberNames(p.ctx)]);
  const list = lists.find((l) => l.id === id);
  if (!list) notFound();
  const it = new Map(items.map((i) => [i.id, i]));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const channel = list.channel_id ? refs.channels.find((c) => c.id === list.channel_id)?.name : 'Todos os canais';
  const detail = await Promise.all(versions.map(async (v) => ({
    v, items: await loadListItems(p.ctx, v.id),
    probs: v.status === 'draft' || v.status === 'pending' || v.status === 'approved' ? await rpc<Problem[]>(p.ctx, 'pr_validate_list_version', { p_org: p.org, p_version: v.id }) : [],
  })));
  const open = versions.find((v) => ['draft', 'pending', 'approved'].includes(v.status));
  return (
    <>
      <PageHeader title={list.name} description={`${channel} · ${list.status === 'archived' ? 'arquivada' : 'ativa'} · preços comerciais internos em versões imutáveis.`} />
      {p.perms.analyst && !open ? <Section title="Nova revisão"><Card className="p-4"><ListVersionForm listId={id} versions={versions.map((v) => ({ value: v.id, label: `v${v.version_number} (${LIST_STATUS_LABELS[v.status]})` }))} /></Card></Section> : null}
      {open ? <Alert tone="info">Há uma revisão em andamento (v{open.version_number}: {LIST_STATUS_LABELS[open.status]}). Conclua, retire ou descarte antes de criar outra.</Alert> : null}
      {detail.map(({ v, items: li, probs }) => {
        const prob = new Map(probs.map((x) => [x.item_id, x]));
        const initial = li.map((x) => [it.get(x.pricing_item_id)?.sku ?? '?', (x.price_cents / 100).toFixed(2).replace('.', ','), x.minimum_quantity_decimal ?? '', x.maximum_quantity_decimal ?? ''].join(';').replace(/;+$/, '')).join('\n');
        return (
          <Section key={v.id} title={`Versão ${v.version_number}`} description={`${LIST_STATUS_LABELS[v.status]} · vigência ${v.valid_from ?? 'imediata'} → ${v.valid_until ?? 'sem fim'}${v.note ? ` · ${v.note}` : ''}`} actions={<Badge tone={v.status === 'published' ? 'success' : v.status === 'rejected' ? 'danger' : 'neutral'}>{LIST_STATUS_LABELS[v.status]}</Badge>}>
            <p className="mb-2 text-xs text-muted">Criada <DateTimeBR value={v.created_at} tz={p.tz} />{v.submitted_by ? ` · enviada por ${who.get(v.submitted_by) ?? '—'}` : ''}{v.reviewed_by ? ` · revisada por ${who.get(v.reviewed_by) ?? '—'}` : ''}{v.published_at ? <> · publicada <DateTimeBR value={v.published_at} tz={p.tz} /></> : null}{v.review_note ? ` · «${v.review_note}»` : ''}</p>
            <TableShell caption={`Itens da versão ${v.version_number}`} empty={li.length === 0} emptyText="Sem itens ainda.">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Item</th><th scope="col" className={TH}>Faixa de quantidade</th><th scope="col" className={TH}>Preço</th><th scope="col" className={TH}>Margem</th><th scope="col" className={TH}>Validação</th></tr></thead>
              <tbody>{li.map((x) => {
                const pr = prob.get(x.pricing_item_id);
                return (
                  <tr key={x.id} className="border-b border-border last:border-0">
                    <td className={TD}>{it.get(x.pricing_item_id)?.sku} <span className="text-muted">{it.get(x.pricing_item_id)?.name}</span></td>
                    <td className={TD}>{x.minimum_quantity_decimal === null && x.maximum_quantity_decimal === null ? 'qualquer' : `${x.minimum_quantity_decimal ?? 0} a ${x.maximum_quantity_decimal ?? '∞'}`}</td>
                    <td className={TD}><Money cents={x.price_cents} /></td><td className={TD}><Pct value={pr?.margin_pct ?? null} /></td>
                    <td className={TD}>{pr ? (pr.flags.length ? pr.flags.map((f) => <Badge key={f} tone="danger">{FLAG_LABELS[f] ?? f}</Badge>) : <Badge tone="success">Dentro das regras</Badge>) : <span className="text-xs text-muted">retrato imutável</span>}</td>
                  </tr>
                );
              })}</tbody>
            </TableShell>
            {v.status === 'draft' && p.perms.analyst ? <div className="mt-3"><Disclosure summary="Editar itens do rascunho" open><ListItemsForm versionId={v.id} initial={initial} /></Disclosure></div> : null}
            <div className="mt-3 space-y-3">
              {v.status === 'pending' && p.perms.manager ? <ReviewForm id={v.id} kind="list" /> : null}
              <ListVersionButtons id={v.id} status={v.status} canManage={p.perms.manager} canAnalyst={p.perms.analyst} mineSubmitted={v.submitted_by === p.ctx.user.id} />
            </div>
          </Section>
        );
      })}
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Money, Pct, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { ActionButton } from '@/components/pricing/fields';
import { archiveScenario } from '@/lib/pricing/actions/pricing';
import { loadChannels, loadItems, loadMemberNames, loadScenario, loadScenarioItems, loadScenarioVersions } from '@/lib/pricing/data';
import { one, type SearchParams } from '@/lib/pricing/filters';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Cenário' };

export default async function ScenarioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await pageCtx();
  const sc = await loadScenario(p.ctx, id);
  if (!sc) notFound();
  const [versions, { rows: items }, channels, members] = await Promise.all([loadScenarioVersions(p.ctx, [id]), loadItems(p.ctx, { limit: 2000 }), loadChannels(p.ctx), loadMemberNames(p.ctx)]);
  const wanted = Number(one(sp.v));
  const v = versions.find((x) => x.version_number === wanted) ?? versions[0];
  const rows = v ? await loadScenarioItems(p.ctx, [v.id]) : [];
  const it = new Map(items.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name])); const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const ov = (itemId: string, channelId: string) => ((v?.input_snapshot_json.items.find((e) => e.item_id === itemId && e.channel_id === channelId)?.overrides ?? {}) as Record<string, number | null>);
  const mine = sc.created_by === p.ctx.user.id;
  return (
    <>
      <PageHeader title={sc.name} description={`${sc.description ?? 'Cenário salvo'} · criado por ${who.get(sc.created_by ?? '') ?? '—'} · motor ${v?.engine_version ?? '—'}. É uma simulação: não representa receita realizada.`}>
        <div className="flex flex-wrap gap-2 text-sm">
          {sc.status === 'active' && p.perms.analyst ? <Link className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground" href={`/cenarios/novo?de=${id}`}>Duplicar como novo</Link> : null}
          <Link className="rounded-md border border-border px-3 py-2" href="/cenarios">Voltar</Link>
        </div>
      </PageHeader>
      {sc.status === 'archived' ? <Alert tone="info">Cenário arquivado: as versões continuam consultáveis, mas não recebe novas.</Alert> : null}
      {v ? (
        <Section title={`Versão ${v.version_number}`} description={`Salva em ${new Date(v.created_at).toLocaleString('pt-BR', { timeZone: p.tz })}. Premissas congeladas: alterar taxas, custos ou políticas depois NÃO muda esta versão.`}>
          <TableShell caption="Resultados do cenário" empty={rows.length === 0}>
            <thead><tr className="border-b border-border">{['Item', 'Canal', 'Preço do cenário', 'Desconto', 'Ajuste de custo', 'Custo variável', 'Taxas', 'Contribuição', 'Margem', 'Markup', 'Preço sugerido', 'Situação'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const o = ov(r.pricing_item_id, r.channel_id);
              return (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className={TD}>{it.get(r.pricing_item_id)?.sku} <span className="text-muted">{it.get(r.pricing_item_id)?.name}</span></td><td className={TD}>{ch.get(r.channel_id)}</td><td className={TD}><Money cents={r.input_price_cents} /></td>
                  <td className={TD}><Pct value={o.discount_pct ?? 0} /></td><td className={TD}><Pct value={o.cost_adjust_pct ?? 0} signed /></td><td className={TD}><Money cents={r.direct_cost_cents} /></td><td className={TD}><Money cents={r.fees_cents} /></td>
                  <td className={TD}><Money cents={r.contribution_cents} /></td><td className={TD}><Pct value={r.margin_decimal} /></td><td className={TD}>{r.markup_decimal === null ? 'n/c' : <Pct value={r.markup_decimal} />}</td>
                  <td className={TD}><Money cents={r.suggested_price_cents} />{r.suggestion_verified === false ? <span className="block text-xs text-warning">não atinge a meta</span> : r.suggestion_verified ? <span className="block text-xs text-success">verificado pelo banco</span> : null}</td>
                  <td className={TD}><Badge tone={r.viable ? 'success' : 'danger'}>{r.viable ? 'Dentro da política' : 'Fora da política'}</Badge></td>
                </tr>
              );
            })}</tbody>
          </TableShell>
        </Section>
      ) : null}
      <Section title="Versões" description="Cada alteração cria uma versão nova; as anteriores ficam preservadas.">
        <TableShell caption="Versões do cenário" empty={versions.length === 0}>
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Salva em</th><th scope="col" className={TH}>Por</th><th scope="col" className={TH} /></tr></thead>
          <tbody>{versions.map((x) => <tr key={x.id} className="border-b border-border last:border-0"><td className={TD}>v{x.version_number}</td><td className={TD}><DateTimeBR value={x.created_at} tz={p.tz} /></td><td className={TD}>{who.get(x.created_by ?? '') ?? '—'}</td><td className={TD}><Link className="underline underline-offset-2" href={`/cenarios/${id}?v=${x.version_number}`}>ver</Link></td></tr>)}</tbody>
        </TableShell>
      </Section>
      {sc.status === 'active' && p.perms.analyst && (mine || p.perms.manager) ? <ActionButton action={archiveScenario} fields={{ id }} label="Arquivar cenário" variant="danger" confirm="Arquivar mantém as versões, mas o cenário deixa de receber alterações. Confirmar?" /> : null}
    </>
  );
}

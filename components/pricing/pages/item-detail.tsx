import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ArchiveItemButton, ItemForm } from '@/components/pricing/catalog-forms';
import { CentsLineChartClient, ChannelMarginBarsClient, CostEvolutionChartClient } from '@/components/pricing/charts-loader';
import { ComponentForm, ComponentRowForm, SaveVersionForm } from '@/components/pricing/cost-forms';
import { Disclosure, DateTimeBR, Money, Pct, RiskBadge, Section, Tabs, TableShell, TD, TH, UnitMoney } from '@/components/pricing/bits';
import { RequestPriceForm, CancelRequestButton } from '@/components/pricing/price-forms';
import { loadAnalysis } from '@/lib/pricing/analysis';
import { costSeries } from '@/lib/pricing/analysis';
import { loadComponents, loadCostVersions, loadEvents, loadItem, loadMemberNames, loadRequests } from '@/lib/pricing/data';
import { D, summarizeCosts, type CostComponentInput, type CostKind } from '@/lib/pricing/engine';
import { one, type SearchParams } from '@/lib/pricing/filters';
import { COST_TYPE_LABELS, ITEM_TYPE_LABELS, REQUEST_STATUS_LABELS, ALLOC_LABELS } from '@/lib/pricing/labels';
import { categoryOpts, channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

const TABS = [['resumo', 'Resumo e margens'], ['custos', 'Composição de custos'], ['precos', 'Preços e histórico']] as const;

export async function ItemDetail({ id, type, sp }: { id: string; type: 'product' | 'service'; sp: SearchParams }) {
  const p = await pageCtx();
  const item = await loadItem(p.ctx, id);
  if (!item || item.item_type !== type) notFound();
  const base = type === 'service' ? '/servicos' : '/produtos';
  const tab = TABS.some(([k]) => k === one(sp.aba)) ? (one(sp.aba) as string) : 'resumo';
  const [refs, rows, comps, versions, events, requests, members] = await Promise.all([
    loadRefs(p.ctx), loadAnalysis(p.ctx, { category: null, channel: null, type: null, item: id, risk: null, policy: null }, p.settings), loadComponents(p.ctx, id), loadCostVersions(p.ctx, id),
    loadEvents(p.ctx, { itemId: id, limit: 200 }), loadRequests(p.ctx, { itemId: id, limit: 50 }), loadMemberNames(p.ctx),
  ]);
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  const chName = new Map(refs.channels.map((c) => [c.id, c.name]));
  const inputs: CostComponentInput[] = comps.map((c) => ({ id: c.id, kind: c.cost_type as CostKind, costClass: c.cost_class, name: c.name, amountCents: c.amount_cents, quantity: c.quantity, usage: c.usage, allocationMethod: c.allocation_method as never, active: c.active }));
  const sum = summarizeCosts(inputs);
  const line = new Map(sum.lines.map((l) => [l.id, l]));
  const cats = categoryOpts(refs.categories);
  const channels = channelOpts(refs.channels);
  const latest = versions[0];
  const open = requests.filter((r) => r.status === 'pending' || r.status === 'approved');
  const draftChanged = latest && sum.directUnitCents !== null && !new D(sum.directUnitCents).eq(latest.direct_unit_cost_cents);

  return (
    <>
      <PageHeader title={`${item.sku} — ${item.name}`} description={`${ITEM_TYPE_LABELS[item.item_type]} · unidade ${item.unit}${item.archived_at ? ' · ARQUIVADO' : ''}`}>
        {p.perms.manager ? <ArchiveItemButton item={item} /> : null}
      </PageHeader>
      <Tabs current={tab} items={TABS.map(([k, l]) => ({ key: k, label: l, href: `${base}/${id}?aba=${k}` }))} />

      {tab === 'resumo' ? (
        <>
          <Section title="Margens por canal" description="Cálculo do motor no preço atual de cada canal, com o custo da última versão salva e as taxas e a política vigentes.">
            {!latest ? <Alert tone="warning">Este item ainda não tem versão de custo. Monte a composição e salve uma versão para calcular margens (custo desconhecido não é tratado como zero).</Alert> : null}
            <TableShell caption="Margens por canal" empty={rows.length === 0} emptyText="Crie ao menos um canal ativo para ver as margens.">
              <thead><tr className="border-b border-border">{['Canal', 'Preço atual', 'Custo', 'Taxas', 'Contribuição', 'Margem', 'Markup', 'Equilíbrio', 'Preço p/ meta', 'Situação'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.channelId} className="border-b border-border last:border-0 align-top">
                  <td className={TD}>{r.channel}{r.priceSource === 'base' ? <span className="block text-xs text-muted">preço-base</span> : null}</td>
                  <td className={TD}><Money cents={r.priceCents} /></td><td className={TD}><UnitMoney cents={r.directUnit} /></td><td className={TD}><Money cents={r.evaluation?.totalFeesCents} /></td>
                  <td className={TD}><Money cents={r.contributionCents} /></td><td className={TD}><Pct value={r.marginPct} /></td><td className={TD}>{r.evaluation ? (r.evaluation.markupPct === null ? 'n/c' : <Pct value={r.evaluation.markupPct} />) : '—'}</td>
                  <td className={TD}><Money cents={r.equilibriumPriceCents} /></td><td className={TD}><Money cents={r.targetPriceCents} /></td>
                  <td className={TD}><RiskBadge state={r.risk.state} label={r.risk.label} /><span className="mt-1 block text-xs text-muted">{r.risk.reasons[0] ?? ''}</span></td>
                </tr>
              ))}</tbody>
            </TableShell>
            {rows.some((r) => r.evaluation) ? (
              <div className="mt-4"><ChannelMarginBarsClient rows={rows.filter((r) => r.marginPct !== null).map((r) => ({ name: r.channel, value: Number(r.marginPct) }))} /></div>
            ) : null}
            {rows.filter((r) => r.evaluation).map((r) => (
              <div key={r.channelId} className="mt-3"><Disclosure summary={`Como este preço foi calculado? — ${r.channel}`}>
                <ol className="space-y-1 text-sm">{r.evaluation!.steps.map((s) => <li key={s.key}><span className="font-medium">{s.label}:</span> {s.cents !== undefined ? <Money cents={s.cents} /> : null}{s.pct !== undefined ? <> <Pct value={s.pct} /></> : null} <span className="text-muted">— {s.formula}{s.note ? ` (${s.note})` : ''}</span></li>)}</ol>
                <p className="mt-2 text-xs text-muted">Política aplicada: {r.policyScope === 'default' ? 'padrão da empresa' : `escopo «${r.policyScope}», versão ${r.policyVersion ?? '—'}`} · meta {r.targetMarginPct} % · mínima {r.minimumMarginPct} % · arredondamento «{r.rounding}».</p>
              </Disclosure></div>
            ))}
          </Section>
          {p.perms.analyst && !item.archived_at ? (
            <Section title="Dados do item"><Card className="p-4"><ItemForm item={item} categories={cats} /></Card></Section>
          ) : null}
        </>
      ) : null}

      {tab === 'custos' ? (
        <>
          <Section title="Rascunho do custo" description="Os componentes abaixo são o RASCUNHO. A versão salva é um retrato imutável; alterar o rascunho não muda versões antigas nem preços já publicados.">
            {sum.issues.length ? <div className="mb-3 space-y-2">{sum.issues.map((i, k) => <Alert key={k} tone="warning">{i.message}</Alert>)}</div> : null}
            <div className="mb-3 grid gap-3 sm:grid-cols-4">
              <Card className="p-3"><p className="text-xs text-muted">Custo direto unitário</p><p className="text-lg font-semibold"><UnitMoney cents={sum.directUnitCents} /></p></Card>
              <Card className="p-3"><p className="text-xs text-muted">Rateio de estrutura</p><p className="text-lg font-semibold">{sum.overheadStatus === 'none' ? '—' : sum.overheadStatus === 'unknown' ? 'desconhecido' : <UnitMoney cents={sum.overheadUnitCents} />}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted">Custo gerencial completo</p><p className="text-lg font-semibold"><UnitMoney cents={sum.fullUnitCents} /></p></Card>
              <Card className="p-3"><p className="text-xs text-muted">Última versão salva</p><p className="text-lg font-semibold">{latest ? <>v{latest.version_number} · <UnitMoney cents={latest.direct_unit_cost_cents} /></> : '—'}</p>{draftChanged ? <p className="text-xs text-warning">O rascunho difere da versão salva.</p> : null}</Card>
            </div>
            <TableShell caption="Componentes do custo" empty={comps.length === 0} emptyText="Nenhum componente. Adicione a compra, a embalagem, a mão de obra…">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Componente</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Valor</th><th scope="col" className={TH}>Custo unitário</th><th scope="col" className={TH}>Participação</th><th scope="col" className={TH}>Editar</th></tr></thead>
              <tbody>{comps.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 align-top">
                  <td className={TD}>{c.name}{!c.active ? <Badge>Inativo</Badge> : null}</td>
                  <td className={TD}>{COST_TYPE_LABELS[c.cost_type as keyof typeof COST_TYPE_LABELS] ?? c.cost_type}{c.allocation_method ? <span className="block text-xs text-muted">{ALLOC_LABELS[c.allocation_method as keyof typeof ALLOC_LABELS]}</span> : null}</td>
                  <td className={TD}>{c.amount_cents === null ? <Badge tone="warning">Desconhecido</Badge> : <UnitMoney cents={c.amount_cents} />}<span className="block text-xs text-muted">÷ {String(c.quantity)} × {String(c.usage)}</span></td>
                  <td className={TD}><UnitMoney cents={line.get(c.id)?.unitCents} /></td><td className={TD}><Pct value={line.get(c.id)?.sharePct} /></td>
                  <td className={TD}>{p.perms.analyst && !item.archived_at ? <ComponentRowForm c={c} /> : null}</td>
                </tr>
              ))}</tbody>
            </TableShell>
          </Section>
          {p.perms.analyst && !item.archived_at ? (
            <>
              <Section title="Adicionar componente"><Card className="p-4"><ComponentForm itemId={id} itemType={type} /></Card></Section>
              <Section title="Salvar versão"><Card className="p-4"><SaveVersionForm itemId={id} /></Card></Section>
            </>
          ) : null}
          <Section title="Versões salvas" description="Imutáveis. A variação compara cada versão com a anterior.">
            <TableShell caption="Versões de custo" empty={versions.length === 0} emptyText="Nenhuma versão salva ainda.">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Salva em</th><th scope="col" className={TH}>Custo direto</th><th scope="col" className={TH}>Rateio</th><th scope="col" className={TH}>Custo completo</th><th scope="col" className={TH}>Variação</th><th scope="col" className={TH}>Por</th><th scope="col" className={TH}>Nota</th></tr></thead>
              <tbody>{versions.map((v, i) => {
                const prev = versions[i + 1];
                const delta = prev && prev.direct_unit_cost_cents > 0 ? new D(v.direct_unit_cost_cents).minus(prev.direct_unit_cost_cents).div(prev.direct_unit_cost_cents).mul(100).toFixed(4) : null;
                return (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className={TD}>v{v.version_number}</td><td className={TD}><DateTimeBR value={v.created_at} tz={p.tz} /></td><td className={TD}><UnitMoney cents={v.direct_unit_cost_cents} /></td>
                    <td className={TD}><UnitMoney cents={v.allocated_overhead_unit_cents} /></td><td className={TD}><UnitMoney cents={v.full_unit_cost_cents} /></td><td className={TD}><Pct value={delta} signed /></td>
                    <td className={TD}>{who.get(v.created_by ?? '') ?? '—'}</td><td className={`${TD} text-xs text-muted`}>{v.note ?? ''}</td>
                  </tr>
                );
              })}</tbody>
            </TableShell>
            {versions.length > 1 ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <CentsLineChartClient title="Evolução do custo direto" description="Custo direto unitário em cada versão salva (R$)." name="Custo direto" rows={[...versions].reverse().map((v) => ({ label: `v${v.version_number}`, value: Math.round(Number(v.direct_unit_cost_cents)) }))} />
              <CostEvolutionChartClient rows={costSeries(versions, '2000-01-01', '2999-12-31', p.tz)} />
            </div> : null}
          </Section>
        </>
      ) : null}

      {tab === 'precos' ? (
        <>
          {p.perms.analyst && !item.archived_at ? <Section title="Propor alteração de preço" description="A proposta vai para aprovação; publicar altera o preço vigente neste sistema (nenhuma plataforma externa é atualizada)."><Card className="p-4"><RequestPriceForm itemId={id} channels={channels} /></Card></Section> : null}
          {open.length ? <Section title="Em andamento"><div className="space-y-2">{open.map((r) => <Alert key={r.id} tone="info">{r.channel_id ? chName.get(r.channel_id) : 'Preço-base'}: <Money cents={r.previous_price_cents} /> → <Money cents={r.proposed_price_cents} /> — {REQUEST_STATUS_LABELS[r.status]} · <Link className="underline" href="/aprovacoes">ver aprovações</Link></Alert>)}</div></Section> : null}
          <Section title="Preços publicados" description="Histórico de alterações publicadas (solicitações e listas). Nunca é reescrito.">
            {events.length > 1 ? <div className="mb-4"><CentsLineChartClient title="Evolução do preço publicado" description="Novo preço a cada publicação (R$)." name="Preço" rows={[...events].reverse().map((e) => ({ label: new Date(e.effective_at).toLocaleDateString('pt-BR'), value: e.new_price_cents }))} /></div> : null}
            <TableShell caption="Preços publicados" empty={events.length === 0} emptyText="Nenhum preço publicado para este item.">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Quando</th><th scope="col" className={TH}>Canal</th><th scope="col" className={TH}>Anterior</th><th scope="col" className={TH}>Novo</th><th scope="col" className={TH}>Origem</th><th scope="col" className={TH}>Por</th></tr></thead>
              <tbody>{events.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0"><td className={TD}><DateTimeBR value={e.effective_at} tz={p.tz} /></td><td className={TD}>{e.channel_id ? chName.get(e.channel_id) ?? '—' : 'Preço-base'}</td><td className={TD}><Money cents={e.previous_price_cents} /></td><td className={TD}><Money cents={e.new_price_cents} /></td>
                  <td className={TD}>{e.list_version_id ? 'Lista de preços' : 'Solicitação'}</td><td className={TD}>{who.get(e.created_by ?? '') ?? '—'}</td></tr>
              ))}</tbody>
            </TableShell>
          </Section>
          <Section title="Solicitações" description="Todas as propostas deste item.">
            <TableShell caption="Solicitações de preço" empty={requests.length === 0} emptyText="Nenhuma solicitação.">
              <thead><tr className="border-b border-border"><th scope="col" className={TH}>Em</th><th scope="col" className={TH}>Canal</th><th scope="col" className={TH}>Proposto</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Proposta por</th><th scope="col" className={TH}>Justificativa</th><th scope="col" className={TH} /></tr></thead>
              <tbody>{requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top"><td className={TD}><DateTimeBR value={r.requested_at} tz={p.tz} /></td><td className={TD}>{r.channel_id ? chName.get(r.channel_id) ?? '—' : 'Preço-base'}</td><td className={TD}><Money cents={r.proposed_price_cents} /></td>
                  <td className={TD}><Badge tone={r.status === 'published' ? 'success' : r.status === 'rejected' || r.status === 'cancelled' ? 'neutral' : 'warning'}>{REQUEST_STATUS_LABELS[r.status]}</Badge></td><td className={TD}>{who.get(r.requested_by) ?? '—'}</td><td className={`${TD} max-w-xs text-xs text-muted`}>{r.justification}</td>
                  <td className={TD}>{(r.status === 'pending' || r.status === 'approved') && p.perms.analyst && (r.requested_by === p.ctx.user.id || p.perms.manager) ? <CancelRequestButton id={r.id} /> : null}</td></tr>
              ))}</tbody>
            </TableShell>
          </Section>
        </>
      ) : null}
    </>
  );
}

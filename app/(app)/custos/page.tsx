import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { ListFilters } from '@/components/pricing/filter-bar';
import { TableShell, TD, TH, UnitMoney } from '@/components/pricing/bits';
import { loadAllComponents, loadCostVersions, loadItems } from '@/lib/pricing/data';
import { D, summarizeCosts, type CostComponentInput, type CostKind } from '@/lib/pricing/engine';
import { one, type SearchParams } from '@/lib/pricing/filters';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Custos' };

export default async function CostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const [{ rows: items }, comps, versions] = await Promise.all([loadItems(p.ctx, { status: 'active', limit: 2000 }), loadAllComponents(p.ctx), loadCostVersions(p.ctx)]);
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) if (!latest.has(v.item_id)) latest.set(v.item_id, v);
  const q = one(sp.situacao) ?? '';
  const data = items.map((it) => {
    const mine: CostComponentInput[] = comps.filter((c) => c.item_id === it.id).map((c) => ({ id: c.id, kind: c.cost_type as CostKind, costClass: c.cost_class, name: c.name, amountCents: c.amount_cents, quantity: c.quantity, usage: c.usage, allocationMethod: c.allocation_method as never, active: c.active }));
    const s = summarizeCosts(mine);
    const v = latest.get(it.id);
    const state = !v ? 'sem_versao' : s.status === 'incomplete' ? 'incompleto' : s.directUnitCents !== null && !new D(s.directUnitCents).eq(v.direct_unit_cost_cents) ? 'rascunho' : 'ok';
    return { it, s, v, state, n: mine.length };
  }).filter((r) => !q || r.state === q);
  return (
    <>
      <PageHeader title="Composição de custos" description="Situação do custo de cada item. Custo desconhecido NÃO é tratado como zero: item incompleto não recebe preço sugerido nem entra nas médias." />
      <ListFilters action="/custos" values={{ situacao: q }} fields={[{ name: 'situacao', label: 'Situação do custo', all: 'Todas', options: [
        { value: 'ok', label: 'Versão salva e em dia' }, { value: 'sem_versao', label: 'Sem versão de custo' }, { value: 'incompleto', label: 'Rascunho incompleto' }, { value: 'rascunho', label: 'Rascunho difere da versão' }], width: 'w-64' }]} />
      <TableShell caption="Situação do custo por item" empty={data.length === 0} emptyText="Nenhum item neste filtro.">
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>Item</th><th scope="col" className={TH}>Componentes</th><th scope="col" className={TH}>Custo direto (rascunho)</th><th scope="col" className={TH}>Versão salva</th><th scope="col" className={TH}>Rateio</th><th scope="col" className={TH}>Situação</th></tr></thead>
        <tbody>{data.map(({ it, s, v, state, n }) => (
          <tr key={it.id} className="border-b border-border last:border-0 align-top">
            <td className={TD}><Link className="underline underline-offset-2" href={`/${it.item_type === 'service' ? 'servicos' : 'produtos'}/${it.id}?aba=custos`}>{it.sku}</Link> <span className="text-muted">{it.name}</span></td>
            <td className={TD}>{n}</td><td className={TD}><UnitMoney cents={s.directUnitCents} /></td>
            <td className={TD}>{v ? <>v{v.version_number} · <UnitMoney cents={v.direct_unit_cost_cents} /></> : '—'}</td>
            <td className={TD}>{s.overheadStatus === 'none' ? '—' : s.overheadStatus === 'unknown' ? 'desconhecido' : <UnitMoney cents={s.overheadUnitCents} />}</td>
            <td className={TD}>{state === 'ok' ? <Badge tone="success">Em dia</Badge> : state === 'sem_versao' ? <Badge tone="warning">Sem versão</Badge> : state === 'incompleto' ? <Badge tone="danger">Incompleto</Badge> : <Badge tone="warning">Rascunho difere</Badge>}
              {s.issues[0] ? <span className="mt-1 block text-xs text-muted">{s.issues[0].message}</span> : null}</td>
          </tr>
        ))}</tbody>
      </TableShell>
      <p className="mt-3 text-xs text-muted">Percentuais de participação de cada componente aparecem na tela do item.</p>
    </>
  );
}

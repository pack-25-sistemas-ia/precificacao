import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { Disclosure, Money, Pagination, TableShell, TD, TH, UnitMoney } from '@/components/pricing/bits';
import { ItemForm } from '@/components/pricing/catalog-forms';
import { ListFilters } from '@/components/pricing/filter-bar';
import { Badge } from '@/components/ui/primitives';
import { loadCostVersions, loadItems } from '@/lib/pricing/data';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { categoryOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export async function ItemsList({ type, sp }: { type: 'product' | 'service'; sp: SearchParams }) {
  const p = await pageCtx();
  const base = type === 'service' ? '/servicos' : '/produtos';
  const page = pageFrom(one(sp.page));
  const [refs, list, versions] = await Promise.all([
    loadRefs(p.ctx),
    loadItems(p.ctx, { type, q: one(sp.q), category: uuidOrNull(one(sp.category)), status: one(sp.status) ?? null, archived: one(sp.arquivados) === '1', page }),
    loadCostVersions(p.ctx),
  ]);
  const cats = categoryOpts(refs.categories);
  const catName = new Map(cats.map((c) => [c.value, c.label]));
  const latest = new Map<string, number>();
  for (const v of versions) if (!latest.has(v.item_id)) latest.set(v.item_id, v.direct_unit_cost_cents);
  const label = type === 'service' ? 'serviço' : 'produto';
  return (
    <>
      <PageHeader title={type === 'service' ? 'Serviços' : 'Produtos'} description={`Cadastro de ${type === 'service' ? 'serviços' : 'produtos'} precificáveis. O preço atual só muda por proposta aprovada e publicada; o custo, por versão salva.`} />
      {p.perms.analyst ? <div className="mb-6"><Disclosure summary={`Cadastrar ${label}`} tone="primary"><ItemForm categories={cats} type={type} /></Disclosure></div> : null}
      <ListFilters action={base} values={{ q: one(sp.q) ?? '', category: one(sp.category) ?? '', status: one(sp.status) ?? '', arquivados: one(sp.arquivados) ?? '' }} fields={[
        { name: 'q', label: 'Buscar por nome ou código', width: 'w-64' },
        { name: 'category', label: 'Categoria', options: cats, all: 'Todas', width: 'w-48' },
        { name: 'status', label: 'Situação', options: [{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }], all: 'Todas', width: 'w-36' },
        { name: 'arquivados', label: 'Arquivados', options: [{ value: '1', label: 'Mostrar só arquivados' }], all: 'Ocultar', width: 'w-44' },
      ]} />
      <TableShell caption={type === 'service' ? 'Serviços' : 'Produtos'} empty={list.rows.length === 0} emptyText={`Nenhum ${label} encontrado. Cadastre o primeiro ou importe um CSV.`}>
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>{type === 'service' ? 'Código' : 'SKU'}</th><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Categoria</th><th scope="col" className={TH}>Unidade</th><th scope="col" className={TH}>Custo direto (última versão)</th><th scope="col" className={TH}>Preço-base</th><th scope="col" className={TH}>Situação</th></tr></thead>
        <tbody>{list.rows.map((i) => (
          <tr key={i.id} className="border-b border-border last:border-0">
            <td className={TD}><Link className="font-medium underline underline-offset-2" href={`${base}/${i.id}`}>{i.sku}</Link></td>
            <td className={TD}>{i.name}</td><td className={TD}>{i.category_id ? catName.get(i.category_id) ?? '—' : '—'}</td><td className={TD}>{i.unit}</td>
            <td className={TD}>{latest.has(i.id) ? <UnitMoney cents={latest.get(i.id)} /> : <Badge tone="warning">Sem versão de custo</Badge>}</td>
            <td className={TD}><Money cents={i.current_base_price_cents} /></td>
            <td className={TD}>{i.archived_at ? <Badge>Arquivado</Badge> : <Badge tone={i.status === 'active' ? 'success' : 'neutral'}>{i.status === 'active' ? 'Ativo' : 'Inativo'}</Badge>}</td>
          </tr>
        ))}</tbody>
      </TableShell>
      <Pagination base={base} sp={sp} page={page} total={list.total} />
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { TableShell, TD, TH } from '@/components/pricing/bits';
import { FilterBar } from '@/components/pricing/filter-bar';
import { buildReport, REPORTS } from '@/lib/pricing/reports';
import { one, resolveFilters, withParams, type SearchParams } from '@/lib/pricing/filters';
import { categoryOpts, channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Relatórios' };
const SHOW = 200;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const f = resolveFilters(sp, p.tz);
  const name = one(sp.r);
  const [refs, rep] = await Promise.all([loadRefs(p.ctx), name ? buildReport(p.ctx, p.settings, name, f) : Promise.resolve(null)]);
  return (
    <>
      <PageHeader title="Relatórios" description="Os mesmos números das telas, com filtros e exportação CSV (só gestão e administração; cada exportação fica registrada na auditoria, sem valores). Preço recomendado é cálculo, não receita realizada." />
      {!rep ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map((r) => (
            <li key={r.name} className="rounded-lg border border-border bg-card p-4">
              <Link className="font-medium underline underline-offset-2" href={`/relatorios?r=${r.name}`}>{r.title}</Link>
              <p className="mt-1 text-sm text-muted">{r.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <FilterBar action="/relatorios" filters={f} categories={categoryOpts(refs.categories)} channels={channelOpts(refs.channels)} extra={{ r: rep.name }} />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">{rep.title}</h2><p className="text-sm text-muted">{rep.description}</p></div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link className="rounded-md border border-border px-3 py-2" href="/relatorios">Todos os relatórios</Link>
              {p.perms.manager ? <a className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground" href={withParams(`/api/export/${rep.name}`, sp, { r: null })}>Exportar CSV</a> : null}
            </div>
          </div>
          <TableShell caption={rep.title} empty={rep.rows.length === 0} emptyText="Nenhum registro para os filtros escolhidos.">
            <thead><tr className="border-b border-border">{rep.head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>{rep.rows.slice(0, SHOW).map((row, i) => <tr key={i} className="border-b border-border last:border-0 align-top">{row.map((c, k) => <td key={k} className={TD}>{c.d}</td>)}</tr>)}</tbody>
          </TableShell>
          <p className="mt-3 text-xs text-muted">{rep.rows.length > SHOW ? `Mostrando ${SHOW} de ${rep.rows.length} linhas; o CSV traz todas${rep.truncated ? ' (limite de 5.000)' : ''}.` : `${rep.rows.length} linha(s).`}</p>
        </>
      )}
    </>
  );
}

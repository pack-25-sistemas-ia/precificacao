import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { Pagination, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { CancelImportForm, CommitImportForm } from '@/components/pricing/import-wizard';
import { IMPORT_LABELS, type ImportType } from '@/lib/pricing/csv';
import { loadImportJob, loadImportRows } from '@/lib/pricing/data';
import { one, pageFrom, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Importação' };
const ROW: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  valid: { label: 'Válida', tone: 'success' }, duplicate: { label: 'Repetida', tone: 'warning' }, error: { label: 'Erro', tone: 'danger' }, applied: { label: 'Aplicada', tone: 'success' },
};
const SHOW = ['sku', 'name', 'channel', 'price', 'amount', 'quantity', 'date', 'gross', 'rate', 'kind', 'parent', 'category', 'unit'];

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id: raw } = await params;
  const sp = await searchParams;
  const id = uuidOrNull(raw);
  if (!id) notFound();
  const p = await pageCtx();
  const job = await loadImportJob(p.ctx, id);
  if (!job) notFound();
  const kind = job.import_type as ImportType;
  const canAct = kind === 'items' || kind === 'costs' || kind === 'prices' ? p.perms.analyst : p.perms.manager;
  const page = pageFrom(one(sp.page));
  const status = ['valid', 'error', 'duplicate', 'applied'].includes(one(sp.s) ?? '') ? one(sp.s) : undefined;
  const { rows, total } = await loadImportRows(p.ctx, id, { status, page, limit: 50 });
  const validRows = job.total_rows - job.failed_rows - job.duplicate_rows;
  const keys = SHOW.filter((k) => rows.some((r) => r.data[k] !== undefined && r.data[k] !== '')).slice(0, 5);
  return (
    <>
      <PageHeader title={job.file_name} description={`${IMPORT_LABELS[kind] ?? kind} · ${job.total_rows} linha(s)`}><Link className="text-sm underline underline-offset-2" href="/importacoes">Voltar</Link></PageHeader>
      <div className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
        {[['Válidas', validRows], ['Repetidas (ignoradas)', job.duplicate_rows], ['Com erro', job.failed_rows], ['Aplicadas', job.successful_rows]].map(([l, n]) => (
          <div key={String(l)} className="rounded-lg border border-border bg-card p-3"><p className="text-muted">{l}</p><p className="text-2xl font-semibold tabular-nums">{n}</p></div>
        ))}
      </div>
      {job.status === 'previewed' ? (
        <Section title="Confirmar">
          {validRows > 0 ? <Alert tone="info">Nada foi gravado ainda. Ao confirmar, as {validRows} linha(s) válida(s) entram de uma só vez; linhas com erro ou repetidas são ignoradas.{kind === 'prices' ? ' Os preços viram propostas pendentes: nenhum preço é publicado.' : ''}{kind === 'costs' ? ' Custos entram no rascunho; salve a versão de custo na tela do item.' : ''}</Alert> : <Alert tone="warning">Nenhuma linha válida: corrija o arquivo e envie de novo.</Alert>}
          {canAct ? <div className="mt-3 flex flex-wrap items-start gap-4">{validRows > 0 ? <CommitImportForm id={id} kind={kind} validRows={validRows} /> : null}<CancelImportForm id={id} kind={kind} /></div> : null}
        </Section>
      ) : null}
      {job.failed_rows + job.duplicate_rows > 0 ? <p className="mb-3 text-sm"><a className="underline underline-offset-2" href={`/api/imports/${id}/erros`}>Baixar relatório de erros e repetidas (CSV)</a></p> : null}
      <Section title="Linhas">
        <nav aria-label="Filtro de linhas" className="mb-3 flex flex-wrap gap-2 text-sm">
          {[['', 'Todas'], ['error', 'Com erro'], ['duplicate', 'Repetidas'], ['valid', 'Válidas'], ['applied', 'Aplicadas']].map(([v, l]) => <Link key={v} className={`rounded-md border px-3 py-1.5 ${(status ?? '') === v ? 'border-primary' : 'border-border'}`} href={v ? `/importacoes/${id}?s=${v}` : `/importacoes/${id}`}>{l}</Link>)}
        </nav>
        <TableShell caption="Linhas da importação" empty={rows.length === 0} emptyText="Nenhuma linha neste filtro.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Linha</th>{keys.map((k) => <th key={k} scope="col" className={TH}>{k}</th>)}<th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Motivo</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 align-top">
              <td className={`${TD} tabular-nums`}>{r.row_number}</td>{keys.map((k) => <td key={k} className={`${TD} max-w-40 truncate`}>{String(r.data[k] ?? '')}</td>)}
              <td className={TD}><Badge tone={ROW[r.status]?.tone ?? 'neutral'}>{ROW[r.status]?.label ?? r.status}</Badge></td><td className={`${TD} text-xs text-danger`}>{r.error_message ?? ''}</td>
            </tr>
          ))}</tbody>
        </TableShell>
        <Pagination base={`/importacoes/${id}`} sp={sp} page={page} total={total} size={50} />
      </Section>
    </>
  );
}

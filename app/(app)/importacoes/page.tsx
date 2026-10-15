import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { ImportWizard } from '@/components/pricing/import-wizard';
import { loadImportJobs } from '@/lib/pricing/data';
import { IMPORT_LABELS, type ImportType } from '@/lib/pricing/csv';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Importações' };
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = { previewed: { label: 'Prévia (nada gravado)', tone: 'warning' }, completed: { label: 'Concluída', tone: 'success' }, cancelled: { label: 'Cancelada', tone: 'neutral' }, failed: { label: 'Falhou', tone: 'danger' } };

export default async function ImportsPage() {
  const p = await pageCtx();
  const jobs = await loadImportJobs(p.ctx);
  return (
    <>
      <PageHeader title="Importações (CSV)" description="Envie planilhas salvas como CSV: o banco valida cada linha na prévia e só a confirmação grava, de uma vez. Preços importados NÃO são publicados: viram propostas para aprovação." />
      {p.perms.analyst ? (
        <Section title="Nova importação"><div className="rounded-lg border border-border bg-card p-4"><ImportWizard canManager={p.perms.manager} /></div></Section>
      ) : <Alert tone="info">Seu perfil não importa dados.</Alert>}
      <Section title="Histórico">
        <TableShell caption="Importações" empty={jobs.length === 0} emptyText="Nenhuma importação ainda.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Arquivo</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Linhas</th><th scope="col" className={TH}>Aplicadas</th><th scope="col" className={TH}>Erros</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Em</th></tr></thead>
          <tbody>{jobs.map((j) => (
            <tr key={j.id} className="border-b border-border last:border-0">
              <td className={TD}><Link className="underline underline-offset-2" href={`/importacoes/${j.id}`}>{j.file_name}</Link></td><td className={TD}>{IMPORT_LABELS[j.import_type as ImportType] ?? j.import_type}</td>
              <td className={TD}>{j.total_rows}</td><td className={TD}>{j.successful_rows}</td><td className={TD}>{j.failed_rows}</td>
              <td className={TD}><Badge tone={STATUS[j.status]?.tone ?? 'neutral'}>{STATUS[j.status]?.label ?? j.status}</Badge></td><td className={TD}><DateTimeBR value={j.created_at} tz={p.tz} /></td>
            </tr>
          ))}</tbody>
        </TableShell>
      </Section>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { DateTimeBR, Pct, TableShell, TD, TH } from '@/components/pricing/bits';
import { loadMemberNames, loadScenarioItems, loadScenarios, loadScenarioVersions } from '@/lib/pricing/data';
import { one, type SearchParams } from '@/lib/pricing/filters';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Cenários' };

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const archived = one(sp.arquivados) === '1';
  const [scenarios, members] = await Promise.all([loadScenarios(p.ctx, { archived }), loadMemberNames(p.ctx)]);
  const versions = scenarios.length ? await loadScenarioVersions(p.ctx, scenarios.map((s) => s.id)) : [];
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) { const c = latest.get(v.scenario_id); if (!c || v.version_number > c.version_number) latest.set(v.scenario_id, v); }
  const items = await loadScenarioItems(p.ctx, [...latest.values()].map((v) => v.id));
  const who = new Map(members.map((m) => [m.user_id, m.display_name]));
  return (
    <>
      <PageHeader title="Cenários" description="Simulações salvas com as premissas congeladas (custo, taxas e política do momento). Mudanças futuras não alteram um cenário salvo; cada alteração cria uma nova versão. Cenário é simulação, não resultado realizado.">
        <div className="flex flex-wrap gap-2 text-sm">
          {p.perms.analyst ? <Link className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground" href="/cenarios/novo">Novo cenário</Link> : null}
          {scenarios.length > 1 ? <Link className="rounded-md border border-border px-3 py-2" href={`/cenarios/comparar?ids=${scenarios.slice(0, 4).map((s) => s.id).join(',')}`}>Comparar os mais recentes</Link> : null}
          <Link className="rounded-md border border-border px-3 py-2" href={archived ? '/cenarios' : '/cenarios?arquivados=1'}>{archived ? 'Ver ativos' : 'Ver arquivados'}</Link>
        </div>
      </PageHeader>
      {!scenarios.length ? <Alert tone="info">Nenhum cenário {archived ? 'arquivado' : 'salvo'}. Use o simulador ou «Novo cenário».</Alert> : null}
      <TableShell caption="Cenários" empty={scenarios.length === 0} emptyText="Nenhum cenário.">
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>Cenário</th><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Itens</th><th scope="col" className={TH}>Margem média</th><th scope="col" className={TH}>Dentro da política</th><th scope="col" className={TH}>Atualizado</th><th scope="col" className={TH}>Criado por</th></tr></thead>
        <tbody>{scenarios.map((s) => {
          const v = latest.get(s.id);
          const li = v ? items.filter((i) => i.scenario_version_id === v.id) : [];
          const ms = li.map((i) => i.margin_decimal).filter((m): m is number => m !== null);
          return (
            <tr key={s.id} className="border-b border-border last:border-0">
              <td className={TD}><Link className="font-medium underline underline-offset-2" href={`/cenarios/${s.id}`}>{s.name}</Link>{s.status === 'archived' ? <Badge>Arquivado</Badge> : null}</td>
              <td className={TD}>v{v?.version_number ?? '—'}</td><td className={TD}>{li.length}</td><td className={TD}><Pct value={ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null} /></td>
              <td className={TD}>{li.filter((i) => i.viable).length} de {li.length}</td><td className={TD}><DateTimeBR value={s.updated_at} tz={p.tz} /></td><td className={TD}>{who.get(s.created_by ?? '') ?? '—'}</td>
            </tr>
          );
        })}</tbody>
      </TableShell>
    </>
  );
}

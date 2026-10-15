import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { Money, Pct, TableShell, TD, TH } from '@/components/pricing/bits';
import { D } from '@/lib/pricing/engine';
import { loadChannels, loadItems, loadScenarioItems, loadScenarios, loadScenarioVersions } from '@/lib/pricing/data';
import { one, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Comparar cenários' };

export default async function CompareScenariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const ids = (one(sp.ids) ?? '').split(',').map((x) => uuidOrNull(x)).filter((x): x is string => !!x).slice(0, 5);
  const all = await loadScenarios(p.ctx);
  const chosen = all.filter((s) => ids.includes(s.id));
  const [versions, { rows: items }, channels] = await Promise.all([chosen.length ? loadScenarioVersions(p.ctx, chosen.map((s) => s.id)) : Promise.resolve([]), loadItems(p.ctx, { limit: 2000 }), loadChannels(p.ctx)]);
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) { const c = latest.get(v.scenario_id); if (!c || v.version_number > c.version_number) latest.set(v.scenario_id, v); }
  const rows = await loadScenarioItems(p.ctx, [...latest.values()].map((v) => v.id));
  const it = new Map(items.map((i) => [i.id, i])); const ch = new Map(channels.map((c) => [c.id, c.name]));
  const pairs = [...new Set(rows.map((r) => `${r.pricing_item_id}|${r.channel_id}`))].sort();
  const cell = (scId: string, key: string) => { const v = latest.get(scId); return v ? rows.find((r) => r.scenario_version_id === v.id && `${r.pricing_item_id}|${r.channel_id}` === key) : undefined; };
  const first = chosen[0];
  return (
    <>
      <PageHeader title="Comparar cenários" description="Lado a lado: última versão de cada cenário escolhido, por item e canal. A diferença é calculada contra o primeiro cenário.">
        <Link className="rounded-md border border-border px-3 py-2 text-sm" href="/cenarios">Escolher outros</Link>
      </PageHeader>
      {chosen.length < 2 ? <Alert tone="warning">Escolha ao menos dois cenários (na lista, use «Comparar os mais recentes» ou monte a URL com <code>?ids=</code>).</Alert> : (
        <TableShell caption="Comparação de cenários">
          <thead>
            <tr className="border-b border-border"><th scope="col" className={TH} rowSpan={2}>Item · Canal</th>{chosen.map((s) => <th key={s.id} scope="colgroup" colSpan={4} className={`${TH} border-l border-border`}>{s.name} (v{latest.get(s.id)?.version_number})</th>)}</tr>
            <tr className="border-b border-border">{chosen.flatMap((s) => ['Preço', 'Contribuição', 'Margem', 'Δ margem'].map((h, i) => <th key={`${s.id}${h}`} scope="col" className={`${TH} ${i === 0 ? 'border-l border-border' : ''}`}>{h}</th>))}</tr>
          </thead>
          <tbody>{pairs.map((key) => {
            const [iid, cid] = key.split('|') as [string, string];
            const base = first ? cell(first.id, key) : undefined;
            return (
              <tr key={key} className="border-b border-border last:border-0">
                <td className={TD}>{it.get(iid)?.sku} <span className="text-muted">· {ch.get(cid)}</span></td>
                {chosen.map((s) => {
                  const c = cell(s.id, key);
                  const delta = c && base && c.margin_decimal !== null && base.margin_decimal !== null && s.id !== first?.id ? new D(c.margin_decimal).minus(base.margin_decimal).toDecimalPlaces(2).toFixed(2) : null;
                  return c ? (<><td key={`${s.id}p`} className={`${TD} border-l border-border`}><Money cents={c.input_price_cents} /></td><td key={`${s.id}c`} className={TD}><Money cents={c.contribution_cents} /></td><td key={`${s.id}m`} className={TD}><Pct value={c.margin_decimal} /></td><td key={`${s.id}d`} className={TD}>{delta === null ? '—' : <Pct value={delta} signed />}</td></>)
                    : (<td key={s.id} colSpan={4} className={`${TD} border-l border-border text-muted`}>não incluído</td>);
                })}
              </tr>
            );
          })}</tbody>
        </TableShell>
      )}
      <p className="mt-3 text-xs text-muted">«Δ margem» são pontos percentuais em relação ao primeiro cenário. Cada cenário usa as premissas congeladas no momento em que foi salvo.</p>
    </>
  );
}

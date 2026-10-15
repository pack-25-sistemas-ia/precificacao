import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { ScenarioBuilder, type BuilderRow } from '@/components/pricing/scenario-builder';
import { loadItems, loadScenario, loadScenarioVersions } from '@/lib/pricing/data';
import { one, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Novo cenário' };

const reais = (c: unknown) => (typeof c === 'number' ? (c / 100).toFixed(2).replace('.', ',') : '');
const num = (v: unknown) => (typeof v === 'number' && v !== 0 ? String(v).replace('.', ',') : '');

export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  if (!p.perms.analyst) notFound();
  const from = uuidOrNull(one(sp.de));
  const [refs, { rows: items }] = await Promise.all([loadRefs(p.ctx), loadItems(p.ctx, { status: 'active', limit: 2000 })]);
  const itemOpts = items.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }));
  const channels = channelOpts(refs.channels);
  let initial: BuilderRow[] | undefined;
  let sourceName = '';
  if (from) {
    const sc = await loadScenario(p.ctx, from);
    if (sc) {
      sourceName = sc.name;
      const v = (await loadScenarioVersions(p.ctx, [from]))[0];
      initial = v?.input_snapshot_json.items.map((e) => {
        const o = (e.overrides ?? {}) as Record<string, unknown>;
        return { itemId: String(e.item_id), channelId: String(e.channel_id), price: reais(o.price_cents), costAdj: num(o.cost_adjust_pct), extra: o.extra_cost_cents ? reais(o.extra_cost_cents) : '', discount: num(o.discount_pct), qty: String(o.quantity ?? 1).replace('.', ',') };
      });
    }
  }
  return (
    <>
      <PageHeader title={sourceName ? `Duplicar cenário «${sourceName}»` : 'Novo cenário'} description="Escolha itens e canais e altere as premissas (preço, custo, desconto). Ao salvar, o banco usa o custo da última versão salva, as taxas do canal e a política vigente e grava os resultados." />
      {!itemOpts.length || !channels.length ? <Alert tone="warning">Cadastre ao menos um item ativo com versão de custo e um canal para montar cenários.</Alert> : <ScenarioBuilder items={itemOpts} channels={channels} initial={initial} initialName={sourceName ? `${sourceName} (cópia)` : ''} />}
    </>
  );
}

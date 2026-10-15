import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ChannelForm } from '@/components/pricing/catalog-forms';
import { Disclosure, Pct, Section } from '@/components/pricing/bits';
import { loadAnalysis } from '@/lib/pricing/analysis';
import { loadChannels, loadFeeRules, loadTaxProfiles } from '@/lib/pricing/data';
import { D } from '@/lib/pricing/engine';
import { CHANNEL_TYPE_LABELS, type ChannelType } from '@/lib/pricing/labels';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Canais' };

export default async function ChannelsPage() {
  const p = await pageCtx();
  const [channels, rules, taxes, rows] = await Promise.all([loadChannels(p.ctx), loadFeeRules(p.ctx), loadTaxProfiles(p.ctx), loadAnalysis(p.ctx, { category: null, channel: null, type: null, item: null, risk: null, policy: null }, p.settings)]);
  const taxOpts = taxes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }));
  return (
    <>
      <PageHeader title="Canais de venda" description="Onde você vende (loja, site, marketplace, B2B…). Cada canal tem suas taxas e, opcionalmente, um perfil tributário informado. Os valores são cadastrados por você: o sistema não consulta nem garante as tarifas vigentes das plataformas." />
      {p.perms.manager ? <div className="mb-6"><Disclosure summary="Criar canal" tone="primary"><ChannelForm taxProfiles={taxOpts} /></Disclosure></div> : null}
      {channels.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum canal ainda. Crie o primeiro para calcular margens.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {channels.map((c) => {
          const mine = rules.filter((r) => r.channel_id === c.id);
          const rs = rows.filter((r) => r.channelId === c.id && r.marginPct !== null);
          const avg = rs.length ? rs.reduce((s, r) => s.plus(r.marginPct!), new D(0)).div(rs.length).toFixed(4) : null;
          return (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h2 className="text-lg font-semibold">{c.name}</h2><p className="text-xs text-muted">{CHANNEL_TYPE_LABELS[c.channel_type as ChannelType] ?? c.channel_type}</p></div>
                <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-muted">Taxas ativas</dt><dd className="font-semibold">{mine.filter((r) => r.active).length}</dd></div>
                <div><dt className="text-xs text-muted">Itens com preço</dt><dd className="font-semibold">{rows.filter((r) => r.channelId === c.id && r.priceCents !== null).length}</dd></div>
                <div><dt className="text-xs text-muted">Margem média simples</dt><dd className="font-semibold"><Pct value={avg} /></dd></div>
              </dl>
              <p className="text-xs text-muted">{c.tax_profile_id ? `Perfil tributário: ${taxes.find((t) => t.id === c.tax_profile_id)?.name ?? '—'}` : 'Sem perfil tributário.'} · <Link className="underline" href={`/taxas?canal=${c.id}`}>ver e cadastrar taxas</Link> · <Link className="underline" href={`/relatorios?r=comparativo-canais`}>comparar canais</Link></p>
              {p.perms.manager ? <Disclosure summary="Editar canal"><ChannelForm channel={c} taxProfiles={taxOpts} /></Disclosure> : null}
            </Card>
          );
        })}
      </div>
      <Section title="Aviso"><p className="text-sm text-muted">Não afirmamos que um canal é mais lucrativo no total: isso depende de volume, devoluções e outros custos que o sistema só conhece se você importar vendas observadas.</p></Section>
    </>
  );
}

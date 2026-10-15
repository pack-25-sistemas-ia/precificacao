import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Kpi, Pct, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import {
  BiggestGapsChartClient, ChannelCompareChartClient, CompositionChartClient, CostEvolutionChartClient, LowestMarginsChartClient, MarginBandsChartClient, MarginByCategoryChartClient,
  PriceEvolutionChartClient, PriceVsTargetChartClient, ScenariosChartClient,
} from '@/components/pricing/charts-loader';
import { FilterBar } from '@/components/pricing/filter-bar';
import { loadDashboard } from '@/lib/pricing/analysis';
import { resolveFilters, type SearchParams } from '@/lib/pricing/filters';
import { categoryOpts, channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';
import { RiskBadge } from '@/components/pricing/bits';
import { Money } from '@/components/pricing/bits';

export const metadata: Metadata = { title: 'Painel' };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const f = resolveFilters(sp, p.tz);
  const [refs, d] = await Promise.all([loadRefs(p.ctx), loadDashboard(p.ctx, f, p.settings)]);
  const { kpis: k, charts: c, rows } = d;
  const empty = refs.channels.length === 0 || rows.length === 0;
  const worst = rows.filter((r) => r.risk.state === 'negative_contribution' || r.risk.state === 'below_target' || r.risk.state === 'incomplete_cost' || r.risk.state === 'invalid_rule').slice(0, 8);
  return (
    <>
      <PageHeader title="Painel de precificação" description={`Alterações publicadas de ${f.from.split('-').reverse().join('/')} a ${f.to.split('-').reverse().join('/')}. Margens são de contribuição unitária calculadas pelo motor com custo vigente, taxas do canal e política aplicável; preço recomendado não é receita realizada.`}>
        {p.perms.analyst ? <div className="flex flex-wrap gap-2 text-sm"><Link className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground" href="/simulador">Abrir simulador</Link><Link className="rounded-md border border-border px-3 py-2" href="/aprovacoes">Aprovações</Link></div> : null}
      </PageHeader>
      <FilterBar action="/dashboard" filters={f} categories={categoryOpts(refs.categories)} channels={channelOpts(refs.channels)} withRisk />

      {empty ? (
        <EmptyState title="Comece cadastrando o que será precificado" description="Crie ao menos um canal de venda, cadastre produtos ou serviços, informe os custos e salve uma versão. Os indicadores aparecem assim que houver itens com custo salvo e preço.">
          {p.perms.analyst ? <span className="flex flex-wrap justify-center gap-4 text-sm"><Link className="underline" href="/canais">Canais</Link><Link className="underline" href="/produtos">Produtos</Link><Link className="underline" href="/importacoes">Importações</Link></span> : null}
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Itens analisados" value={k.itemsAnalyzed} definition={`Itens com custo salvo e preço, com cálculo válido no escopo (${k.marginPairs} item × canal).`} />
            <Kpi label="Margem média simples" value={<Pct value={k.averageMarginSimplePct} />} definition="Média aritmética das margens de contribuição de cada item × canal elegível. NÃO é margem consolidada ponderada." />
            <Kpi label="Abaixo da meta" value={k.belowTargetItems} tone={k.belowTargetItems ? 'danger' : 'neutral'} definition={`Itens com margem abaixo da mínima da política (${k.belowTargetPairs} item × canal).`} />
            <Kpi label="Contribuição negativa" value={k.negativeContributionItems} tone={k.negativeContributionItems ? 'danger' : 'neutral'} definition={`Itens cujo preço atual não cobre custo variável e taxas (${k.negativeContributionPairs} item × canal).`} />
            <Kpi label="Custo incompleto" value={k.incompleteCostItems} tone={k.incompleteCostItems ? 'warning' : 'neutral'} definition="Itens sem versão de custo ou com componente de valor desconhecido. Não entram nas médias." />
            <Kpi label="Diferença média de preço" value={<Pct value={k.averagePriceGapPct} signed />} definition={`Média de (preço atual − preço para a meta) ÷ preço para a meta, em ${k.gapPairs} item × canal com ambos calculáveis.`} />
            <Kpi label="Preços alterados no período" value={d.pricesChanged} definition="Publicações internas (solicitações e listas) no período filtrado." />
            <Kpi label="Cenários salvos" value={d.scenariosSaved} definition="Cenários ativos (não arquivados) com ao menos uma versão." />
            <Kpi label="Variação de custo" value={<Pct value={k.costVariationAvgPct} signed />} definition={`Média da variação entre as duas últimas versões de custo de ${k.costVariationItems} item(ns); ${k.costIncreasedItems} com aumento.`} />
            <Kpi label="Itens por canal" value={k.itemsByChannel.length} definition={k.itemsByChannel.length ? k.itemsByChannel.map((x) => `${x.channel}: ${x.items}`).join(' · ') : 'Nenhum item com preço em canal.'} />
          </div>

          {worst.length ? (
            <Section title="Atenção" description="Itens que pedem ação agora (primeiros 8).">
              <TableShell caption="Itens que pedem atenção">
                <thead><tr className="border-b border-border"><th scope="col" className={TH}>Item</th><th scope="col" className={TH}>Canal</th><th scope="col" className={TH}>Preço atual</th><th scope="col" className={TH}>Margem</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Por quê</th></tr></thead>
                <tbody>{worst.map((r) => (
                  <tr key={`${r.itemId}-${r.channelId}`} className="border-b border-border last:border-0">
                    <td className={TD}><Link className="underline underline-offset-2" href={`/${r.itemType === 'service' ? 'servicos' : 'produtos'}/${r.itemId}`}>{r.sku}</Link> <span className="text-muted">{r.name}</span></td>
                    <td className={TD}>{r.channel}</td><td className={TD}><Money cents={r.priceCents} /></td><td className={TD}><Pct value={r.marginPct} /></td>
                    <td className={TD}><RiskBadge state={r.risk.state} label={r.risk.label} /></td><td className={`${TD} text-xs text-muted`}>{r.risk.reasons[0] ?? r.error ?? ''}</td>
                  </tr>
                ))}</tbody>
              </TableShell>
            </Section>
          ) : <Alert tone="success">Nenhum item abaixo da meta, com contribuição negativa ou com custo incompleto neste escopo.</Alert>}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <MarginByCategoryChartClient rows={c.marginByCategory.map((r) => ({ name: r.name, value: r.marginPct }))} />
            <MarginBandsChartClient rows={c.marginBands} />
            <PriceVsTargetChartClient rows={c.currentVsTarget} />
            <CostEvolutionChartClient rows={d.costSeries} />
            <ChannelCompareChartClient rows={c.channelComparison} />
            <CompositionChartClient rows={c.composition} />
            <BiggestGapsChartClient rows={c.biggestGaps.map((r) => ({ name: r.name, value: r.gapPp }))} />
            <ScenariosChartClient rows={d.scenarioCompare} />
            <PriceEvolutionChartClient rows={d.priceSeries} />
            <LowestMarginsChartClient rows={c.lowestMargins.map((r) => ({ name: r.name, value: r.marginPct }))} />
          </div>
          <p className="mt-4 text-xs text-muted">Fórmulas e dados de conferência em docs/METRICS.md. Tributos aparecem somente como parâmetros informados pela empresa; o sistema não calcula tributo oficial.</p>
        </>
      )}
    </>
  );
}

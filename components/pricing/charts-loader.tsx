'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const MarginByCategoryChartClient = dynamic(() => import('./charts').then((m) => m.MarginByCategoryChart), { ssr: false, loading: Skeleton });
export const MarginBandsChartClient = dynamic(() => import('./charts').then((m) => m.MarginBandsChart), { ssr: false, loading: Skeleton });
export const PriceVsTargetChartClient = dynamic(() => import('./charts').then((m) => m.PriceVsTargetChart), { ssr: false, loading: Skeleton });
export const CostEvolutionChartClient = dynamic(() => import('./charts').then((m) => m.CostEvolutionChart), { ssr: false, loading: Skeleton });
export const ChannelCompareChartClient = dynamic(() => import('./charts').then((m) => m.ChannelCompareChart), { ssr: false, loading: Skeleton });
export const CompositionChartClient = dynamic(() => import('./charts').then((m) => m.CompositionChart), { ssr: false, loading: Skeleton });
export const BiggestGapsChartClient = dynamic(() => import('./charts').then((m) => m.BiggestGapsChart), { ssr: false, loading: Skeleton });
export const ScenariosChartClient = dynamic(() => import('./charts').then((m) => m.ScenariosChart), { ssr: false, loading: Skeleton });
export const PriceEvolutionChartClient = dynamic(() => import('./charts').then((m) => m.PriceEvolutionChart), { ssr: false, loading: Skeleton });
export const LowestMarginsChartClient = dynamic(() => import('./charts').then((m) => m.LowestMarginsChart), { ssr: false, loading: Skeleton });
export const CentsLineChartClient = dynamic(() => import('./charts').then((m) => m.CentsLineChart), { ssr: false, loading: Skeleton });
export const ChannelMarginBarsClient = dynamic(() => import('./charts').then((m) => m.ChannelMarginBars), { ssr: false, loading: Skeleton });

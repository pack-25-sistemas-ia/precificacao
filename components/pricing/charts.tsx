'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL } from '@/lib/pricing/money';

// Gráficos só no navegador (ver charts-loader.tsx). Todos os valores vêm do banco/motor; cada gráfico traz uma tabela alternativa acessível.
export type NamePct = { name: string; value: number };
export type NameCents = { name: string; cents: number };
export type CompareRow = { name: string; a: number; b: number };
export type LinePt = { label: string; value: number };

const GREEN = '#047857';
const RED = '#b91c1c';
const CYAN = '#0e7490';
const SLATE = '#64748b';
const AMBER = '#b45309';
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 });
const tickBrl = (v: number) => compact.format(v / 100);
const fmtPct = (v: unknown) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %`;
const brl = (v: unknown) => formatBRL(Number(v));
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;
const short = (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v);

function Frame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: ReactNode; table: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no escopo selecionado</p> : <div className="h-[260px] w-full text-foreground">{children}</div>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Ver dados em tabela</summary><div className="mt-2 overflow-x-auto">{table}</div></details>
    </section>
  );
}
const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const T = ({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);

function HBarPct({ title, description, rows, caption, valueLabel, signed = false }: { title: string; description: string; rows: NamePct[]; caption: string; valueLabel: string; signed?: boolean }) {
  return (
    <Frame title={title} description={description} empty={rows.length === 0}
      table={<T caption={caption} head={['Item', valueLabel]}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{fmtPct(r.value)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis type="number" tick={TICK} tickFormatter={(v: number) => `${v}%`} /><YAxis type="category" dataKey="name" tick={TICK} width={110} tickFormatter={short} /><Tooltip contentStyle={TOOLTIP} formatter={fmtPct} />
          <Bar isAnimationActive={false} dataKey="value" name={valueLabel} fill={CYAN} radius={[0, 4, 4, 0]}>{signed ? rows.map((r) => <Cell key={r.name} fill={r.value < 0 ? RED : CYAN} />) : null}</Bar></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export const MarginByCategoryChart = ({ rows }: { rows: NamePct[] }) => <HBarPct title="Margem por categoria" description="Média simples das margens de contribuição por categoria (não é margem consolidada ponderada)." rows={rows} caption="Margem média por categoria" valueLabel="Margem média" signed />;
export const BiggestGapsChart = ({ rows }: { rows: NamePct[] }) => <HBarPct title="Maiores distâncias da meta" description="Pontos percentuais que faltam para a margem-alvo da política (só itens abaixo da meta)." rows={rows} caption="Itens com maior diferença para a meta" valueLabel="Falta (p.p.)" />;
export const LowestMarginsChart = ({ rows }: { rows: NamePct[] }) => <HBarPct title="Margem por produto ou serviço" description="As menores margens de contribuição no preço atual." rows={rows} caption="Menores margens por item" valueLabel="Margem" signed />;

export function MarginBandsChart({ rows }: { rows: Array<{ band: string; count: number }> }) {
  return (
    <Frame title="Itens por faixa de margem" description="Quantidade de itens × canais em cada faixa de margem de contribuição no preço atual." empty={rows.every((r) => r.count === 0)}
      table={<T caption="Itens por faixa de margem" head={['Faixa', 'Itens × canais']}>{rows.map((r) => <tr key={r.band}><td className={TD}>{r.band}</td><td className={TD}>{r.count}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="band" tick={TICK} interval={0} /><YAxis tick={TICK} allowDecimals={false} width={40} /><Tooltip contentStyle={TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="count" name="Itens × canais" radius={[4, 4, 0, 0]}>{rows.map((r, i) => <Cell key={r.band} fill={i === 0 ? RED : i < 2 ? AMBER : GREEN} />)}</Bar></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function PriceVsTargetChart({ rows }: { rows: Array<{ name: string; currentCents: number; targetCents: number }> }) {
  return (
    <Frame title="Preço atual × preço recomendado" description="Os 10 itens com maior diferença. O recomendado é o preço para a margem-alvo (cálculo, não receita realizada)." empty={rows.length === 0}
      table={<T caption="Preço atual e recomendado" head={['Item', 'Preço atual', 'Recomendado']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{formatBRL(r.currentCents)}</td><td className={TD}>{formatBRL(r.targetCents)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} tickFormatter={short} /><YAxis tick={TICK} tickFormatter={tickBrl} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={brl} /><Legend />
          <Bar isAnimationActive={false} dataKey="currentCents" name="Preço atual" fill={SLATE} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="targetCents" name="Recomendado" fill={CYAN} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CostEvolutionChart({ rows }: { rows: Array<{ month: string; avgChangePct: number; versions: number }> }) {
  return (
    <Frame title="Evolução dos custos" description="Variação média do custo direto entre versões salvas em cada mês (só itens que já tinham versão anterior)." empty={rows.length === 0}
      table={<T caption="Variação mensal de custo" head={['Mês', 'Variação média', 'Versões comparadas']}>{rows.map((r) => <tr key={r.month}><td className={TD}>{r.month}</td><td className={TD}>{fmtPct(r.avgChangePct)}</td><td className={TD}>{r.versions}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="month" tick={TICK} /><YAxis tick={TICK} tickFormatter={(v: number) => `${v}%`} width={48} /><Tooltip contentStyle={TOOLTIP} formatter={fmtPct} />
          <Line isAnimationActive={false} type="monotone" dataKey="avgChangePct" name="Variação média" stroke={AMBER} strokeWidth={2} /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function ChannelCompareChart({ rows }: { rows: Array<{ name: string; marginPct: number; contributionCents: number; items: number }> }) {
  return (
    <Frame title="Comparação entre canais" description="Margem média simples e contribuição média por unidade em cada canal. Não indica lucro total (falta volume e outros custos)." empty={rows.length === 0}
      table={<T caption="Comparação entre canais" head={['Canal', 'Margem média', 'Contribuição média', 'Itens']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{fmtPct(r.marginPct)}</td><td className={TD}>{formatBRL(r.contributionCents)}</td><td className={TD}>{r.items}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} tickFormatter={short} /><YAxis tick={TICK} tickFormatter={(v: number) => `${v}%`} width={48} /><Tooltip contentStyle={TOOLTIP} formatter={fmtPct} />
          <Bar isAnimationActive={false} dataKey="marginPct" name="Margem média" fill={GREEN} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CompositionChart({ rows }: { rows: Array<{ name: string; pct: number }> }) {
  return (
    <Frame title="Composição do preço" description="Quanto da receita unitária vai para custo variável, taxas/tributos informados e contribuição (soma dos itens × canais com preço)." empty={rows.length === 0}
      table={<T caption="Composição da receita" head={['Parte', '% da receita']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{fmtPct(r.pct)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} /><YAxis tick={TICK} tickFormatter={(v: number) => `${v}%`} width={48} /><Tooltip contentStyle={TOOLTIP} formatter={fmtPct} />
          <Bar isAnimationActive={false} dataKey="pct" name="% da receita" radius={[4, 4, 0, 0]}>{rows.map((r, i) => <Cell key={r.name} fill={[SLATE, AMBER, GREEN][i] ?? CYAN} />)}</Bar></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function ScenariosChart({ rows }: { rows: Array<{ name: string; marginPct: number; viable: number; total: number; version: number }> }) {
  return (
    <Frame title="Cenários comparativos" description="Margem média simples da última versão de cada cenário salvo (parâmetros congelados no momento do salvamento)." empty={rows.length === 0}
      table={<T caption="Cenários comparativos" head={['Cenário', 'Versão', 'Margem média', 'Itens dentro da política']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.version}</td><td className={TD}>{fmtPct(r.marginPct)}</td><td className={TD}>{r.viable} de {r.total}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} interval={0} tickFormatter={short} /><YAxis tick={TICK} tickFormatter={(v: number) => `${v}%`} width={48} /><Tooltip contentStyle={TOOLTIP} formatter={fmtPct} />
          <Bar isAnimationActive={false} dataKey="marginPct" name="Margem média" radius={[4, 4, 0, 0]}>{rows.map((r) => <Cell key={r.name} fill={r.marginPct < 0 ? RED : CYAN} />)}</Bar></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function PriceEvolutionChart({ rows }: { rows: Array<{ month: string; count: number; avgChangePct: number | null }> }) {
  return (
    <Frame title="Evolução dos preços publicados" description="Preços publicados neste sistema por mês (solicitações e listas). A tabela mostra a variação média quando havia preço anterior." empty={rows.length === 0}
      table={<T caption="Preços publicados por mês" head={['Mês', 'Publicações', 'Variação média']}>{rows.map((r) => <tr key={r.month}><td className={TD}>{r.month}</td><td className={TD}>{r.count}</td><td className={TD}>{r.avgChangePct === null ? '—' : fmtPct(r.avgChangePct)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="month" tick={TICK} /><YAxis tick={TICK} allowDecimals={false} width={40} /><Tooltip contentStyle={TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="count" name="Publicações" fill={CYAN} radius={[4, 4, 0, 0]} /></BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function CentsLineChart({ title, description, rows, name }: { title: string; description: string; rows: LinePt[]; name: string }) {
  return (
    <Frame title={title} description={description} empty={rows.length === 0}
      table={<T caption={title} head={['Data', `${name} (R$)`]}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatBRL(r.value)}</td></tr>)}</T>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><Grid /><XAxis dataKey="label" tick={TICK} minTickGap={16} /><YAxis tick={TICK} tickFormatter={tickBrl} width={64} /><Tooltip contentStyle={TOOLTIP} formatter={brl} />
          <Line isAnimationActive={false} type="stepAfter" dataKey="value" name={name} stroke={CYAN} strokeWidth={2} dot /></LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function ChannelMarginBars({ rows }: { rows: NamePct[] }) {
  return (
    <HBarPct title="Margem por canal" description="Margem de contribuição do item no preço atual de cada canal." rows={rows} caption="Margem por canal" valueLabel="Margem" signed />
  );
}

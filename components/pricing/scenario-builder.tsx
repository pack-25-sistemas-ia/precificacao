'use client';

import { useId, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { saveScenario } from '@/lib/pricing/actions/pricing';
import { parseBRL } from '@/lib/pricing/money';
import { parseQty } from '@/lib/pricing/qty';
import type { Opt } from './bits';
import { usePrAction } from './use-pr-action';

export type BuilderRow = { itemId: string; channelId: string; price: string; costAdj: string; extra: string; discount: string; qty: string };
const pctNum = (s: string, signed = false): number | null => {
  const t = s.replace('%', '').trim();
  if (!t) return 0;
  const neg = signed && t.startsWith('-');
  const q = parseQty(neg ? t.slice(1) : t, 4, { allowZero: true });
  return q === null ? null : (neg ? -Number(q) : Number(q));
};
const blankRow = (items: Opt[], channels: Opt[]): BuilderRow => ({ itemId: items[0]?.value ?? '', channelId: channels[0]?.value ?? '', price: '', costAdj: '', extra: '', discount: '', qty: '1' });

/** Monta um cenário com vários itens. O navegador só envia PARÂMETROS; preço sugerido, custos, taxas e resultados são calculados e gravados pelo servidor/banco. */
export function ScenarioBuilder({ items, channels, initial, scenarioId, initialName }: { items: Opt[]; channels: Opt[]; initial?: BuilderRow[]; scenarioId?: string; initialName?: string }) {
  const p = useId();
  const [rows, setRows] = useState<BuilderRow[]>(initial?.length ? initial : [blankRow(items, channels)]);
  const [state, action, ref] = usePrAction(saveScenario, { reset: false });
  const e = state.fieldErrors ?? {};
  const set = (i: number, patch: Partial<BuilderRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const { payload, problems } = useMemo(() => {
    const out: Array<Record<string, unknown>> = [];
    const errs: string[] = [];
    rows.forEach((r, i) => {
      const price = r.price.trim() ? parseBRL(r.price) : null;
      const adj = pctNum(r.costAdj, true); const disc = pctNum(r.discount); const q = parseQty(r.qty || '1', 6);
      const extra = r.extra.trim() ? parseBRL(r.extra) : 0;
      if (!r.itemId || !r.channelId) errs.push(`Linha ${i + 1}: escolha item e canal.`);
      else if ((r.price.trim() && price === null) || adj === null || disc === null || q === null || extra === null || (disc ?? 0) >= 100) errs.push(`Linha ${i + 1}: confira preço, ajuste de custo, desconto (< 100 %) e quantidade.`);
      else out.push({ item_id: r.itemId, channel_id: r.channelId, price_cents: price, quantity: Number(q), cost_adjust_pct: adj, extra_cost_cents: extra, discount_pct: disc });
    });
    return { payload: JSON.stringify(out), problems: errs };
  }, [rows]);

  return (
    <form ref={ref} action={action} className="space-y-5" noValidate>
      {scenarioId ? <input type="hidden" name="scenario_id" value={scenarioId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do cenário" name={`${p}name`} errors={e.name}><Input id={`${p}name`} name="name" required maxLength={80} defaultValue={state.values?.name ?? initialName} placeholder="Ex.: Conservador (+10 % nos custos)" /></Field>
        <Field label="Descrição (opcional)" name={`${p}desc`} errors={e.description}><Input id={`${p}desc`} name="description" maxLength={500} defaultValue={state.values?.description ?? ''} /></Field>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Itens do cenário</caption>
          <thead><tr className="text-left text-xs uppercase text-muted">{['Item', 'Canal', 'Preço (R$)', 'Ajuste de custo (%)', 'Custo extra (R$)', 'Desconto (%)', 'Qtd.', ''].map((h) => <th key={h} scope="col" className="px-2 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-2 py-1.5"><Select aria-label={`Item da linha ${i + 1}`} value={r.itemId} onChange={(ev) => set(i, { itemId: ev.target.value })} className="w-56">{items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Select aria-label={`Canal da linha ${i + 1}`} value={r.channelId} onChange={(ev) => set(i, { channelId: ev.target.value })} className="w-40">{channels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Input aria-label={`Preço da linha ${i + 1}`} inputMode="decimal" value={r.price} onChange={(ev) => set(i, { price: ev.target.value })} placeholder="atual" className="w-28" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Ajuste de custo da linha ${i + 1}`} inputMode="decimal" value={r.costAdj} onChange={(ev) => set(i, { costAdj: ev.target.value })} placeholder="0" className="w-24" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Custo extra da linha ${i + 1}`} inputMode="decimal" value={r.extra} onChange={(ev) => set(i, { extra: ev.target.value })} placeholder="0,00" className="w-24" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Desconto da linha ${i + 1}`} inputMode="decimal" value={r.discount} onChange={(ev) => set(i, { discount: ev.target.value })} placeholder="0" className="w-24" /></td>
                <td className="px-2 py-1.5"><Input aria-label={`Quantidade da linha ${i + 1}`} inputMode="decimal" value={r.qty} onChange={(ev) => set(i, { qty: ev.target.value })} className="w-20" /></td>
                <td className="px-2 py-1.5"><Button type="button" variant="secondary" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs))} disabled={rows.length === 1} aria-label={`Remover a linha ${i + 1}`}>Remover</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setRows((rs) => (rs.length < 200 ? [...rs, blankRow(items, channels)] : rs))}>Adicionar linha</Button>
        <p className="text-xs text-muted">Preço em branco usa o preço atual do item no canal. O banco usa o custo da última versão salva, as taxas do canal e a política vigente na data de hoje.</p>
      </div>
      {problems.length ? <Alert tone="warning">{problems.join(' ')}</Alert> : null}
      {e.payload ? <Alert tone="error">{e.payload.join(' ')}</Alert> : null}
      <input type="hidden" name="payload" value={payload} />
      <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Calculando e salvando…">{scenarioId ? 'Salvar nova versão do cenário' : 'Salvar cenário'}</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}

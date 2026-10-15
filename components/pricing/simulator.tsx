'use client';

import { useId, useMemo, useState } from 'react';
import { Alert, Card, Field, Input, Select } from '@/components/ui/primitives';
import { requestPriceChange, saveScenario } from '@/lib/pricing/actions/pricing';
import { D, PricingError, analyzeDiscount, evaluate, solvePrice, type FeeLine, type RoundingRule } from '@/lib/pricing/engine';
import { ROUNDING_LABELS, ROUNDING_RULES } from '@/lib/pricing/labels';
import { formatBRL, parseBRL } from '@/lib/pricing/money';
import { parseQty, parseUnitCostCents } from '@/lib/pricing/qty';
import { cn } from '@/lib/utils';
import { PrForm, TextF } from './fields';

export type SimContext = {
  itemId: string | null; channelId: string | null; label: string | null;
  variableUnitCents: string | null; overheadUnitCents: string | null; fees: FeeLine[];
  policy: { targetMarginPct: string; minimumMarginPct: string; maxDiscountPct: string | null; rounding: RoundingRule; minPriceCents: number | null; scope: string };
  currentPriceCents: number | null; incompleteReason: string | null;
};

const pct = (s: string | null | undefined) => (s === null || s === undefined || s === '' ? '—' : `${Number(s).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);
const money = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatBRL(c));
const toReais = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const parsePctText = (s: string): string | null => { const q = parseQty(s.replace(/%/g, '').trim(), 4, { allowZero: true }); return q; };
const unitText = (cents: string | null) => (cents === null ? '' : new D(cents).div(100).toFixed(4).replace(/\.?0+$/, '').replace('.', ','));

function Num({ id, label, value, onChange, hint, suffix, className }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string; className?: string }) {
  return (
    <Field label={label} name={id} hint={hint}>
      <div className="flex items-center gap-2"><Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={className} />{suffix ? <span className="text-sm text-muted">{suffix}</span> : null}</div>
    </Field>
  );
}

export function Simulator({ ctx, canPropose, canSave, focus }: { ctx: SimContext; canPropose: boolean; canSave: boolean; focus: 'price' | 'discount' }) {
  const p = useId();
  const [cost, setCost] = useState(unitText(ctx.variableUnitCents));
  const [extraCost, setExtraCost] = useState('');
  const [overhead, setOverhead] = useState(unitText(ctx.overheadUnitCents));
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState(toReais(ctx.currentPriceCents));
  const [target, setTarget] = useState(ctx.policy.targetMarginPct.replace('.', ','));
  const [minimum] = useState(ctx.policy.minimumMarginPct);
  const [rounding, setRounding] = useState<RoundingRule>(ctx.policy.rounding);
  const [extraFeePct, setExtraFeePct] = useState('');
  const [fixedFee, setFixedFee] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [discountFixed, setDiscountFixed] = useState('');
  const manual = !ctx.itemId;

  const calc = useMemo(() => {
    const errors: string[] = [];
    const variable = parseUnitCostCents(cost);
    const extra = extraCost.trim() ? parseUnitCostCents(extraCost) : '0';
    const ovh = overhead.trim() ? parseUnitCostCents(overhead) : null;
    const q = parseQty(qty || '1', 6);
    const priceCents = price.trim() ? parseBRL(price) : null;
    const tgt = parsePctText(target);
    if (variable === null) errors.push(manual ? 'Informe o custo variável por unidade (R$).' : 'Custo variável inválido.');
    if (extra === null) errors.push('Custo adicional inválido.');
    if (overhead.trim() && ovh === null) errors.push('Rateio inválido.');
    if (q === null) errors.push('Quantidade deve ser maior que zero.');
    if (tgt === null || Number(tgt) >= 100) errors.push('Margem-alvo deve estar entre 0 e 100 (exclusive).');
    if (price.trim() && priceCents === null) errors.push('Preço atual inválido.');
    const fees: FeeLine[] = [...ctx.fees];
    if (extraFeePct.trim()) { const r = parsePctText(extraFeePct); if (r === null || Number(r) > 100) errors.push('Outras taxas: percentual inválido.'); else fees.push({ id: 'manual-pct', name: 'Outras taxas (manual)', kind: 'other', basis: 'price', ratePct: r }); }
    if (fixedFee.trim()) { const c = parseUnitCostCents(fixedFee); if (c === null) errors.push('Taxa fixa inválida.'); else fees.push({ id: 'manual-fixed', name: 'Taxa fixa por unidade (manual)', kind: 'other', basis: 'fixed_unit', fixedCents: c }); }
    if (errors.length || variable === null || q === null || tgt === null || extra === null) return { kind: 'err' as const, errors };
    const varCost = new D(variable).plus(extra);
    try {
      const common = { variableUnitCost: varCost, overheadUnit: ovh, fees, quantity: q };
      const targetRes = solvePrice({ ...common, targetMarginPct: tgt, rounding, floorCents: ctx.policy.minPriceCents });
      const equil = solvePrice({ ...common, targetMarginPct: 0, rounding: 'up' });
      const ev = priceCents && priceCents > 0 ? evaluate({ priceCents, ...common }) : null;
      let disc = null as ReturnType<typeof analyzeDiscount> | null;
      let discError: string | null = null;
      const hasDisc = discountPct.trim() || discountFixed.trim();
      if (hasDisc && priceCents && priceCents > 0) {
        try {
          const dp = discountPct.trim() ? parsePctText(discountPct) : null; const df = discountFixed.trim() ? parseBRL(discountFixed) : null;
          if ((discountPct.trim() && dp === null) || (discountFixed.trim() && df === null)) throw new PricingError('invalid_discount', 'Desconto inválido.');
          disc = analyzeDiscount({ listPriceCents: priceCents, discount: { percent: dp, fixedCents: df }, ...common, minMarginPct: minimum });
        } catch (e) { discError = e instanceof Error ? e.message : 'Desconto inválido.'; }
      }
      return { kind: 'ok' as const, errors, varCost, ovh, q, tgt, fees, targetRes, equil, ev, priceCents, disc, discError };
    } catch (e) { return { kind: 'err' as const, errors: [e instanceof Error ? e.message : 'Erro de cálculo.'] }; }
  }, [cost, extraCost, overhead, qty, price, target, minimum, rounding, extraFeePct, fixedFee, discountPct, discountFixed, ctx, manual]);

  const c = calc.kind === 'ok' ? calc : null;
  const targetPrice = c && c.targetRes.status === 'ok' ? c.targetRes.priceCents : null;
  const gap = c && c.priceCents && targetPrice ? new D(c.priceCents).minus(targetPrice).div(targetPrice).mul(100).toDecimalPlaces(2).toFixed(2) : null;
  const taxTotal = c && c.ev ? c.ev.fees.filter((f) => f.kind === 'tax').reduce((s, f) => s + f.amountCents, 0) : null;
  const ev = c ? c.ev : null;
  const parts = ev ? [
    { k: 'Custo', v: ev.variableCostCents, c: 'bg-slate-500' }, { k: 'Taxas e tributos', v: ev.totalFeesCents, c: 'bg-amber-600' }, { k: 'Contribuição', v: Math.max(0, ev.contributionCents), c: 'bg-emerald-600' },
  ] : [];
  const totalParts = parts.reduce((s, x) => s + x.v, 0) || 1;
  const priceForForm = targetPrice ?? calc.errors.length === 0 ? targetPrice : null;

  const payload = useMemo(() => {
    if (!ctx.itemId || !ctx.channelId || !c || !c.priceCents) return '';
    const dp = discountPct.trim() ? Number((parsePctText(discountPct) ?? '0')) : 0;
    const baseCost = ctx.variableUnitCents ? new D(ctx.variableUnitCents) : null;
    const typed = parseUnitCostCents(cost);
    const adj = baseCost && typed && baseCost.gt(0) ? Number(new D(typed).minus(baseCost).div(baseCost).mul(100).toDecimalPlaces(4)) : 0;
    return JSON.stringify([{ item_id: ctx.itemId, channel_id: ctx.channelId, price_cents: c.priceCents, quantity: Number(qty.replace(',', '.')) || 1, cost_adjust_pct: Math.max(-100, Math.min(1000, adj)), extra_cost_cents: extraCost.trim() ? Number(parseUnitCostCents(extraCost) ?? 0) : 0, discount_pct: dp, target_margin_pct: Number(parsePctText(target) ?? '0') }]);
  }, [ctx, c, cost, qty, extraCost, discountPct, target]);

  return (
    <div className="space-y-6">
      {ctx.incompleteReason ? <Alert tone="warning">{ctx.incompleteReason}</Alert> : null}
      {manual ? <Alert tone="info">Modo livre: informe os valores abaixo. Para usar o custo salvo e as taxas do canal, escolha um item e um canal na parte de cima.</Alert> : <Alert tone="info">Valores carregados de <strong>{ctx.label}</strong>: custo da última versão salva, taxas do canal e política {ctx.policy.scope === 'default' ? 'padrão da empresa' : 'vigente'}. Você pode alterar qualquer campo para simular; nada é gravado até você salvar um cenário ou propor um preço.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card title="Entradas" className="space-y-3">
          <Num id={`${p}cost`} label="Custo variável unitário (R$)" value={cost} onChange={setCost} hint="Até 4 casas." />
          <Num id={`${p}extra`} label="Custo adicional unitário (R$)" value={extraCost} onChange={setExtraCost} hint="Frete, embalagem extra… (opcional)" />
          <Num id={`${p}ovh`} label="Rateio de estrutura por unidade (R$)" value={overhead} onChange={setOverhead} hint="Opcional; só afeta o resultado gerencial." />
          <Num id={`${p}extrafee`} label="Outras taxas sobre o preço (%)" value={extraFeePct} onChange={setExtraFeePct} suffix="%" />
          <Num id={`${p}fixed`} label="Taxa fixa por unidade (R$)" value={fixedFee} onChange={setFixedFee} />
          <Num id={`${p}qty`} label="Quantidade da venda" value={qty} onChange={setQty} />
          <Num id={`${p}price`} label={focus === 'discount' ? 'Preço de lista (R$)' : 'Preço atual (R$)'} value={price} onChange={setPrice} />
          <Num id={`${p}target`} label="Margem-alvo (%)" value={target} onChange={setTarget} suffix="%" hint={`Margem mínima da política: ${pct(minimum)}.`} />
          <Field label="Arredondamento do preço" name={`${p}round`}><Select id={`${p}round`} value={rounding} onChange={(e) => setRounding(e.target.value as RoundingRule)}>{ROUNDING_RULES.map((r) => <option key={r} value={r}>{ROUNDING_LABELS[r]}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Num id={`${p}dp`} label="Desconto (%)" value={discountPct} onChange={(v) => { setDiscountPct(v); if (v.trim()) setDiscountFixed(''); }} suffix="%" />
            <Num id={`${p}df`} label="ou desconto fixo (R$)" value={discountFixed} onChange={(v) => { setDiscountFixed(v); if (v.trim()) setDiscountPct(''); }} />
          </div>
          {ctx.fees.length ? (
            <div className="rounded-md border border-border p-3 text-xs">
              <p className="mb-1 font-medium">Taxas do canal consideradas</p>
              <ul className="space-y-0.5 text-muted">{ctx.fees.map((f) => <li key={f.id}>{f.name}: {f.ratePct !== null && f.ratePct !== undefined ? `${String(f.ratePct).replace('.', ',')} %` : money(Number(f.fixedCents))} ({f.basis === 'net_price' ? 'sobre o líquido' : f.basis === 'cost' ? 'sobre o custo' : f.basis === 'price' ? 'sobre o preço' : 'fixa'}){f.maxCents ? ` · teto ${money(Number(f.maxCents))}` : ''}</li>)}</ul>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4" aria-live="polite">
          {calc.errors.length ? <Alert tone={manual && !cost.trim() && calc.errors.length === 1 ? 'info' : 'error'}>{manual && !cost.trim() && calc.errors.length === 1 ? 'Informe o custo variável unitário (R$) para ver o preço, a margem e o markup.' : calc.errors.join(' ')}</Alert> : null}
          {c ? (<>
            {c.targetRes.status === 'inviable' ? <Alert tone="error"><strong>Cenário inviável.</strong> {c.targetRes.reason} (denominador {c.targetRes.denominator}). Nenhum preço foi sugerido.</Alert> : null}
            {c.targetRes.status === 'unresolvable' ? <Alert tone="warning">{c.targetRes.reason}</Alert> : null}
            {c.targetRes.status === 'ok' && !c.targetRes.meetsTarget ? <Alert tone="warning">O arredondamento deixa a margem {c.targetRes.shortfallPp} p.p. abaixo da meta. Use «Sempre para cima» para garantir a meta.</Alert> : null}
            {c.targetRes.status === 'ok' && c.targetRes.multipleRoots ? <Alert tone="info">Há mais de um preço que atinge a meta por causa de tetos/pisos de taxa; foi escolhido o menor.</Alert> : null}
            {ev && ev.contributionCents < 0 ? <Alert tone="error">No preço informado a contribuição é <strong>negativa</strong>: o preço não cobre custo variável e taxas.</Alert> : null}
            {ev && ev.marginPct !== null && Number(ev.marginPct) < Number(minimum) && ev.contributionCents >= 0 ? <Alert tone="warning">Margem abaixo da mínima da política ({pct(minimum)}).</Alert> : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Card className="p-4"><p className="text-sm text-muted">Custo variável total</p><p className="text-xl font-semibold tabular-nums">{money(ev?.variableCostCents ?? Math.round(Number(c.varCost.mul(Number(c.q))))) }</p><p className="text-xs text-muted">custo unitário × quantidade</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Taxas</p><p className="text-xl font-semibold tabular-nums">{money(ev?.totalFeesCents)}</p><p className="text-xs text-muted">{taxTotal ? `Tributos informados: ${money(taxTotal)}` : 'Recalculadas sobre o preço final'}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Preço de equilíbrio unitário</p><p className="text-xl font-semibold tabular-nums">{c.equil.status === 'ok' ? money(c.equil.priceCents) : '—'}</p><p className="text-xs text-muted">contribuição zero</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Preço para a margem-alvo</p><p className="text-xl font-semibold tabular-nums">{money(targetPrice)}</p><p className="text-xs text-muted">{c.targetRes.status === 'ok' ? `margem obtida ${pct(c.targetRes.achievedMarginPct)}` : 'sem preço sugerido'}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Contribuição unitária</p><p className={cn('text-xl font-semibold tabular-nums', ev && ev.contributionCents < 0 && 'text-danger')}>{ev ? money(Math.round(Number(ev.contributionUnitCents))) : '—'}</p><p className="text-xs text-muted">preço − custo − taxas</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Margem de contribuição</p><p className={cn('text-xl font-semibold tabular-nums', ev && Number(ev.marginPct) < 0 && 'text-danger')}>{pct(ev?.marginPct)}</p><p className="text-xs text-muted">contribuição ÷ preço</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Markup</p><p className="text-xl font-semibold tabular-nums">{ev ? (ev.markupPct === null ? 'não calculável' : pct(ev.markupPct)) : '—'}</p><p className="text-xs text-muted">sobre o custo variável (não é margem)</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Resultado gerencial após rateio</p><p className={cn('text-xl font-semibold tabular-nums', ev?.managerialCents != null && ev.managerialCents < 0 && 'text-danger')}>{ev ? money(ev.managerialCents) : '—'}</p><p className="text-xs text-muted">não é lucro líquido contábil</p></Card>
              <Card className="p-4"><p className="text-sm text-muted">Preço atual × sugerido</p><p className="text-xl font-semibold tabular-nums">{gap === null ? '—' : `${Number(gap) > 0 ? '+' : ''}${gap.replace('.', ',')} %`}</p><p className="text-xs text-muted">{gap === null ? 'informe o preço atual' : Number(gap) >= 0 ? 'atual acima do alvo' : 'atual abaixo do alvo'}</p></Card>
            </div>

            {ev ? (
              <Card title="Composição do preço" description="De cada R$ 100,00 do preço: custo, taxas/tributos e contribuição.">
                <div className="flex h-5 w-full overflow-hidden rounded" role="img" aria-label={parts.map((x) => `${x.k} ${(x.v / totalParts * 100).toFixed(1)} por cento`).join(', ')}>
                  {parts.map((x) => <div key={x.k} className={x.c} style={{ width: `${(x.v / totalParts) * 100}%` }} />)}
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{parts.map((x) => <li key={x.k}><span className={cn('mr-1 inline-block size-2.5 rounded-sm', x.c)} />{x.k}: {money(x.v)} ({(x.v / totalParts * 100).toFixed(1).replace('.', ',')} %)</li>)}</ul>
              </Card>
            ) : null}

            {c.disc ? (
              <Card title="Efeito do desconto">
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted">Preço final</dt><dd className="font-semibold tabular-nums">{money(c.disc.finalPriceCents)}</dd></div>
                  <div><dt className="text-muted">Contribuição antes → depois</dt><dd className="tabular-nums">{money(c.disc.before.contributionCents)} → <strong>{money(c.disc.after.contributionCents)}</strong> ({c.disc.contributionDeltaCents > 0 ? '+' : ''}{money(c.disc.contributionDeltaCents)})</dd></div>
                  <div><dt className="text-muted">Margem antes → depois</dt><dd className="tabular-nums">{pct(c.disc.before.marginPct)} → <strong>{pct(c.disc.after.marginPct)}</strong></dd></div>
                  <div><dt className="text-muted">Desconto máximo respeitando a margem mínima</dt><dd className="tabular-nums">{c.disc.maxDiscountPct === null ? 'indisponível' : `${c.disc.maxDiscountPct.replace('.', ',')} %`}</dd></div>
                </dl>
                {c.disc.maxDiscountNote ? <p className="mt-2 text-xs text-muted">{c.disc.maxDiscountNote}</p> : null}
                {c.disc.negativeContribution ? <div className="mt-2"><Alert tone="error">Com este desconto a contribuição fica negativa.</Alert></div> : c.disc.belowMinMargin ? <div className="mt-2"><Alert tone="warning">Com este desconto a margem fica abaixo da mínima.</Alert></div> : null}
                {ctx.policy.maxDiscountPct && c.priceCents && c.disc && new D(c.priceCents).minus(c.disc.finalPriceCents).div(c.priceCents).mul(100).gt(ctx.policy.maxDiscountPct) ? <div className="mt-2"><Alert tone="warning">O desconto passa do máximo da política ({pct(ctx.policy.maxDiscountPct)}).</Alert></div> : null}
              </Card>
            ) : null}
            {'discError' in calc && c.discError ? <Alert tone="error">{c.discError}</Alert> : null}

            <Card title="Como este preço foi calculado?" description="Passo a passo do motor, com os valores usados (arredondamento só em centavos, meio-para-cima).">
              <ol className="space-y-1 text-sm">
                {c.targetRes.status === 'ok' ? c.targetRes.steps.map((s) => <li key={`t-${s.key}`}><span className="font-medium">{s.label}:</span> {s.cents !== undefined ? money(s.cents) : null}{s.pct ? ` ${pct(s.pct)}` : ''} <span className="text-muted">— {s.formula}{s.note ? ` (${s.note})` : ''}</span></li>) : <li className="text-muted">Sem preço sugerido: veja o aviso acima.</li>}
                {ev ? <li className="mt-2 border-t border-border pt-2 font-medium">No preço informado ({money(ev.priceCents)}):</li> : null}
                {ev ? ev.steps.map((s) => <li key={`e-${s.key}`}><span className="font-medium">{s.label}:</span> {s.cents !== undefined ? money(s.cents) : null}{s.pct !== undefined ? ` ${pct(s.pct ?? null)}` : ''} <span className="text-muted">— {s.formula}{s.note ? ` (${s.note})` : ''}</span></li>) : null}
              </ol>
            </Card>
          </>) : null}
        </div>
      </div>

      {ctx.itemId && ctx.channelId ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {canPropose ? (
            <Card title="Propor este preço" description="Cria uma solicitação para aprovação. O impacto é recalculado pelo banco com os custos, taxas e política vigentes.">
              <PrForm action={requestPriceChange} submit="Enviar para aprovação" hidden={{ item_id: ctx.itemId, channel_id: ctx.channelId }} className="grid gap-3 sm:grid-cols-2">
                {(f) => (<>
                  <TextF f={f} name="price" label="Preço proposto (R$)" inputMode="decimal" def={toReais(priceForForm)} required />
                  <TextF f={f} name="justification" label="Justificativa" required max={500} placeholder="Mínimo de 5 caracteres" />
                </>)}
              </PrForm>
            </Card>
          ) : null}
          {canSave ? (
            <Card title="Salvar como cenário" description="Congela as premissas atuais. O banco recalcula e grava os resultados; mudanças futuras de taxa ou custo não alteram o cenário salvo.">
              <PrForm action={saveScenario} submit="Salvar cenário" hidden={{ payload }} className="grid gap-3 sm:grid-cols-2">
                {(f) => (<>
                  <TextF f={f} name="name" label="Nome do cenário" required max={80} placeholder="Ex.: Meta de 30 % no marketplace" />
                  <TextF f={f} name="description" label="Descrição (opcional)" max={500} />
                </>)}
              </PrForm>
              {!payload ? <p className="mt-2 text-xs text-muted">Corrija os campos e informe o preço para habilitar o salvamento.</p> : null}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

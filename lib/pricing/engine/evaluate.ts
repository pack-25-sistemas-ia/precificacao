// Avaliação direta (docs/PRICING_ENGINE.md §3): dado um preço, calcula taxas, contribuição, margem e markup.
// É a «verdade» do cálculo; o solver só procura o preço e SEMPRE confere pelo caminho daqui. O banco espelha esta função (pr_evaluate).
import { D, MAX_CENTS, PricingError, dec, pctText, priceCentsOf, roundCents, type Dec } from './decimal';
import type { EvalInput, EvalResult, FeeBasis, FeeKind, FeeLine, FeeResult, MarkupBase, Step } from './types';

const BASES: readonly FeeBasis[] = ['price', 'net_price', 'cost', 'fixed_unit', 'fixed_transaction'];
const KINDS: readonly FeeKind[] = ['commission', 'payment', 'platform', 'shipping_subsidy', 'transaction', 'tax', 'other'];
const RATE_BASES = new Set<FeeBasis>(['price', 'net_price', 'cost']);
const HUNDRED = new D(100);

export type PreparedFee = { fee: FeeLine; basis: FeeBasis; rate: Dec | null; fixed: Dec | null; min: Dec | null; max: Dec | null };

const optional = (v: FeeLine['minCents'], what: string): Dec | null => (v === null || v === undefined || v === '' ? null : dec(v, what));

/** Valida e normaliza as linhas de taxa. Erros em português, com o nome da taxa. */
export function prepareFees(fees: readonly FeeLine[]): PreparedFee[] {
  const seen = new Set<string>();
  return fees.map((fee) => {
    const label = `Taxa «${fee.name}»`;
    if (!fee.id || seen.has(fee.id)) throw new PricingError('invalid_fee', `${label}: identificador ausente ou repetido.`);
    seen.add(fee.id);
    if (!BASES.includes(fee.basis)) throw new PricingError('invalid_fee', `${label}: base de incidência inválida.`);
    if (!KINDS.includes(fee.kind)) throw new PricingError('invalid_fee', `${label}: tipo inválido.`);
    const min = optional(fee.minCents, `${label}: mínimo`);
    const max = optional(fee.maxCents, `${label}: máximo`);
    if ((min && min.lt(0)) || (max && max.lt(0))) throw new PricingError('invalid_fee', `${label}: mínimo e máximo não podem ser negativos.`);
    if (min && max && min.gt(max)) throw new PricingError('invalid_fee', `${label}: o mínimo não pode superar o máximo.`);
    if (RATE_BASES.has(fee.basis)) {
      const rate = fee.ratePct === null || fee.ratePct === undefined || fee.ratePct === '' ? null : dec(fee.ratePct, `${label}: percentual`);
      if (rate === null) throw new PricingError('invalid_fee', `${label}: informe o percentual.`);
      if (rate.lt(0) || rate.gt(100)) throw new PricingError('invalid_fee', `${label}: o percentual deve estar entre 0 e 100.`);
      if (fee.fixedCents !== null && fee.fixedCents !== undefined && fee.fixedCents !== '') throw new PricingError('invalid_fee', `${label}: base percentual não aceita valor fixo.`);
      return { fee, basis: fee.basis, rate, fixed: null, min, max };
    }
    const fixed = fee.fixedCents === null || fee.fixedCents === undefined || fee.fixedCents === '' ? null : dec(fee.fixedCents, `${label}: valor fixo`);
    if (fixed === null) throw new PricingError('invalid_fee', `${label}: informe o valor fixo.`);
    if (fixed.lt(0) || fixed.gt(MAX_CENTS)) throw new PricingError('invalid_fee', `${label}: valor fixo fora do limite.`);
    if (fee.ratePct !== null && fee.ratePct !== undefined && fee.ratePct !== '') throw new PricingError('invalid_fee', `${label}: base fixa não aceita percentual.`);
    if (min || max) throw new PricingError('invalid_fee', `${label}: mínimo e máximo valem só para taxas percentuais.`);
    return { fee, basis: fee.basis, rate: null, fixed, min: null, max: null };
  });
}

/** Problemas de coerência do conjunto de taxas (para validar no cadastro): o que torna a fórmula inválida. */
export function feeSetProblems(fees: readonly FeeLine[]): string[] {
  const out: string[] = [];
  const prepared = prepareFees(fees);
  const priceSum = prepared.filter((p) => p.basis === 'price' && p.max === null).reduce((s, p) => s.plus(p.rate ?? 0), new D(0));
  if (priceSum.gte(100)) out.push('A soma das taxas percentuais sobre o preço chega a 100 % ou mais: nenhum preço cobre o custo.');
  return out;
}

export type FeeComputation = { fee: PreparedFee; amount: Dec; raw: Dec; capped: 'min' | 'max' | null };

/** Taxas de uma transação. `round = true` arredonda cada linha a centavos (resultado persistido); `false` é o modelo contínuo (solver). */
export function computeFees(prepared: readonly PreparedFee[], revenue: Dec, variableCost: Dec, quantity: Dec, round: boolean): FeeComputation[] {
  const fix = (v: Dec) => (round ? v.toDecimalPlaces(0, D.ROUND_HALF_UP) : v);
  const out = new Map<string, FeeComputation>();
  const limit = (p: PreparedFee, raw: Dec): FeeComputation => {
    let v = raw;
    let capped: 'min' | 'max' | null = null;
    if (p.min && v.lt(p.min)) { v = p.min; capped = 'min'; }
    if (p.max && v.gt(p.max)) { v = p.max; capped = 'max'; }
    return { fee: p, amount: fix(v), raw, capped };
  };
  let priceFees = new D(0);
  for (const p of prepared) {
    if (p.basis === 'net_price') continue;
    let raw: Dec;
    if (p.basis === 'price') raw = p.rate!.div(HUNDRED).mul(revenue);
    else if (p.basis === 'cost') raw = p.rate!.div(HUNDRED).mul(variableCost);
    else if (p.basis === 'fixed_unit') raw = p.fixed!.mul(quantity);
    else raw = p.fixed!;
    const c = limit(p, raw);
    out.set(p.fee.id, c);
    if (p.basis === 'price') priceFees = priceFees.plus(c.amount);
  }
  const net = D.max(0, revenue.minus(priceFees));
  for (const p of prepared) {
    if (p.basis !== 'net_price') continue;
    out.set(p.fee.id, limit(p, p.rate!.div(HUNDRED).mul(net)));
  }
  return prepared.map((p) => out.get(p.fee.id)!);
}

const reais = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function evaluate(input: EvalInput): EvalResult {
  const priceCents = priceCentsOf(input.priceCents);
  const q = dec(input.quantity ?? 1, 'Quantidade');
  if (q.lte(0) || q.gt(1_000_000_000)) throw new PricingError('invalid_quantity', 'Quantidade precisa ser maior que zero.');
  const cost = dec(input.variableUnitCost, 'Custo variável');
  if (cost.lt(0) || cost.gt(MAX_CENTS)) throw new PricingError('invalid_cost', 'Custo variável fora do limite.');
  const overhead = input.overheadUnit === null || input.overheadUnit === undefined ? null : dec(input.overheadUnit, 'Rateio');
  if (overhead && (overhead.lt(0) || overhead.gt(MAX_CENTS))) throw new PricingError('invalid_cost', 'Rateio fora do limite.');
  const markupBase: MarkupBase = input.markupBase ?? 'variable_cost';
  const prepared = prepareFees(input.fees);

  const revenueCents = roundCents(new D(priceCents).mul(q), 'Receita');
  const variableCostCents = roundCents(cost.mul(q), 'Custo variável');
  const computed = computeFees(prepared, new D(revenueCents), new D(variableCostCents), q, true);
  const totalFeesCents = computed.reduce((s, c) => s + c.amount.toNumber(), 0);
  const contributionCents = revenueCents - variableCostCents - totalFeesCents;
  const revenue = new D(revenueCents);
  const margin = revenue.gt(0) ? new D(contributionCents).div(revenue) : null;

  const base = markupBase === 'full_cost' ? cost.plus(overhead ?? 0) : cost;
  const markup = base.gt(0) ? new D(priceCents).minus(base).div(base) : null;
  const overheadCents = overhead ? roundCents(overhead.mul(q), 'Rateio') : null;
  const managerialCents = overheadCents === null ? null : contributionCents - overheadCents;
  const managerialMargin = managerialCents === null || !revenue.gt(0) ? null : new D(managerialCents).div(revenue);

  const fees: FeeResult[] = computed.map((c) => ({
    id: c.fee.fee.id, name: c.fee.fee.name, kind: c.fee.fee.kind, basis: c.fee.basis,
    amountCents: c.amount.toNumber(), unitCents: c.amount.div(q).toDecimalPlaces(6).toFixed(), capped: c.capped,
  }));

  const steps: Step[] = [
    { key: 'revenue', label: 'Receita da transação', formula: 'preço × quantidade', cents: revenueCents, note: `${reais(priceCents)} × ${q.toString()}` },
    { key: 'cost', label: 'Custo variável', formula: 'custo unitário × quantidade', cents: -variableCostCents },
    ...fees.map((f): Step => ({
      key: `fee:${f.id}`, label: f.name,
      formula: f.basis === 'price' ? '% sobre o preço' : f.basis === 'net_price' ? '% sobre o preço líquido de taxas' : f.basis === 'cost' ? '% sobre o custo variável' : f.basis === 'fixed_unit' ? 'valor fixo × unidades' : 'valor fixo por transação',
      cents: -f.amountCents, note: f.capped === 'min' ? 'aplicado o mínimo' : f.capped === 'max' ? 'aplicado o máximo' : undefined,
    })),
    { key: 'contribution', label: 'Contribuição', formula: 'receita − custo variável − taxas', cents: contributionCents },
    { key: 'margin', label: 'Margem de contribuição', formula: 'contribuição ÷ receita', pct: pctText(margin) },
    { key: 'markup', label: 'Markup', formula: `(preço − ${markupBase === 'full_cost' ? 'custo completo' : 'custo variável'}) ÷ custo-base`, pct: pctText(markup), note: markup === null ? 'custo-base zero: não calculável' : undefined },
  ];
  if (managerialCents !== null) steps.push({ key: 'managerial', label: 'Resultado gerencial após rateio', formula: 'contribuição − rateio (não é lucro líquido contábil)', cents: managerialCents });

  return {
    priceCents, quantity: q.toString(), revenueCents, variableCostCents, fees, totalFeesCents, contributionCents,
    contributionUnitCents: new D(contributionCents).div(q).toDecimalPlaces(6).toFixed(), marginPct: pctText(margin),
    markupBase, markupBaseUnitCents: base.toDecimalPlaces(6).toFixed(), markupPct: pctText(markup),
    overheadCents, managerialCents, managerialMarginPct: pctText(managerialMargin), steps,
  };
}

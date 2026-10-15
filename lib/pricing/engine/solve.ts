// Solver (docs/PRICING_ENGINE.md §4): acha o preço que entrega a margem-alvo e CONFERE o resultado pela avaliação direta.
// Nunca devolve preço para cenário inviável (denominador ≤ 0) nem para sistema que não consegue verificar.
import { D, PricingError, dec, pctText, type Dec } from './decimal';
import { computeFees, evaluate, prepareFees, type PreparedFee } from './evaluate';
import type { RoundingRule, SolveInput, SolveResult, Step } from './types';

const MAX_CAPPED = 8;
const EPS = new D('1e-6');
const HUNDRED = new D(100);

/** Arredondamento do preço unitário (centavos). `charm_*` sobe até a próxima terminação ,90 / ,99. */
export function roundPrice(exact: Dec, rule: RoundingRule): number {
  const up = exact.ceil();
  switch (rule) {
    case 'nearest': return exact.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
    case 'up': return up.toNumber();
    case 'down': return exact.floor().toNumber();
    case 'charm_90':
    case 'charm_99': {
      const end = rule === 'charm_90' ? 90 : 99;
      let candidate = up.div(100).floor().mul(100).plus(end);
      if (candidate.lt(up)) candidate = candidate.plus(100);
      return candidate.toNumber();
    }
    default: throw new PricingError('invalid_policy', 'Regra de arredondamento inválida.');
  }
}

type Regime = 'L' | 'MIN' | 'MAX';
type Linear = { a: Dec; b: Dec };

/** Combinações de regimes (livre/piso/teto) das taxas percentuais limitadas. */
function* combos(options: Regime[][]): Generator<Regime[]> {
  const idx = options.map(() => 0);
  while (true) {
    yield idx.map((i, k) => options[k]![i]!);
    let k = options.length - 1;
    while (k >= 0) {
      idx[k]!++;
      if (idx[k]! < options[k]!.length) break;
      idx[k] = 0; k--;
    }
    if (k < 0) return;
  }
}

export function solvePrice(input: SolveInput): SolveResult {
  const q = dec(input.quantity ?? 1, 'Quantidade');
  if (q.lte(0) || q.gt(1_000_000_000)) throw new PricingError('invalid_quantity', 'Quantidade precisa ser maior que zero.');
  const cost = dec(input.variableUnitCost, 'Custo variável');
  if (cost.lt(0)) throw new PricingError('invalid_cost', 'Custo variável não pode ser negativo.');
  const overhead = input.overheadUnit === null || input.overheadUnit === undefined ? null : dec(input.overheadUnit, 'Rateio');
  const m = dec(input.targetMarginPct, 'Margem-alvo');
  if (m.lt(0) || m.gte(100)) throw new PricingError('invalid_margin', 'A margem-alvo deve estar entre 0 % e 100 % (exclusive).');
  const basis = input.targetBasis ?? 'contribution';
  if (basis === 'managerial' && overhead === null) throw new PricingError('invalid_margin', 'Margem gerencial exige o rateio de estrutura informado.');
  const rounding = input.rounding ?? 'nearest';
  const prepared = prepareFees(input.fees);
  const mr = m.div(HUNDRED);

  const costTx = cost.mul(q);
  const K = costTx.plus(basis === 'managerial' ? overhead!.mul(q) : 0);

  // Taxas constantes em relação ao preço (sobre custo e fixas) e taxas dependentes da receita (sobre preço / preço líquido).
  const dependent = prepared.filter((p) => p.basis === 'price' || p.basis === 'net_price');
  const constants = prepared.filter((p) => p.basis !== 'price' && p.basis !== 'net_price');
  const constantTotal = computeFees(constants, new D(0), costTx, q, false).reduce((s, c) => s.plus(c.amount), new D(0));
  const capped = dependent.filter((p) => p.min || p.max);
  if (capped.length > MAX_CAPPED) return { status: 'unresolvable', reason: `Mais de ${MAX_CAPPED} taxas com mínimo/máximo: não é possível resolver com segurança.` };
  const options: Regime[][] = capped.map((p) => ['L', ...(p.min ? (['MIN'] as Regime[]) : []), ...(p.max ? (['MAX'] as Regime[]) : [])]);

  const candidates: Array<{ R: Dec; regime: string }> = [];
  let positiveDenominator = false;
  let worstDenominator: Dec | null = null;
  for (const combo of combos(options)) {
    const regimeOf = new Map<string, Regime>();
    capped.forEach((p, i) => regimeOf.set(p.fee.id, combo[i]!));
    const lin = (p: PreparedFee, priceA: Dec, priceB: Dec): Linear => {
      const r = regimeOf.get(p.fee.id) ?? 'L';
      if (r === 'MIN') return { a: new D(0), b: p.min! };
      if (r === 'MAX') return { a: new D(0), b: p.max! };
      if (p.basis === 'price') return { a: p.rate!.div(HUNDRED), b: new D(0) };
      return { a: p.rate!.div(HUNDRED).mul(new D(1).minus(priceA)), b: p.rate!.div(HUNDRED).mul(priceB).neg() };
    };
    let priceA = new D(0); let priceB = new D(0);
    for (const p of dependent) if (p.basis === 'price') { const l = lin(p, priceA, priceB); priceA = priceA.plus(l.a); priceB = priceB.plus(l.b); }
    let sumA = priceA; let sumB = priceB.plus(constantTotal);
    for (const p of dependent) if (p.basis === 'net_price') { const l = lin(p, priceA, priceB); sumA = sumA.plus(l.a); sumB = sumB.plus(l.b); }

    const denominator = new D(1).minus(mr).minus(sumA);
    if (worstDenominator === null || denominator.lt(worstDenominator)) worstDenominator = denominator;
    if (denominator.lte(0)) continue;
    positiveDenominator = true;
    const R = K.plus(sumB).div(denominator);
    if (R.lt(0)) continue;
    // verificação pelo modelo contínuo completo (com os tetos/pisos reais)
    const fees = computeFees(prepared, R, costTx, q, false).reduce((s, c) => s.plus(c.amount), new D(0));
    const result = R.minus(K).minus(fees);
    if (result.minus(mr.mul(R)).abs().gt(EPS)) continue;
    const label = capped.map((p, i) => (combo[i] === 'L' ? null : `${p.fee.name}: ${combo[i] === 'MAX' ? 'teto' : 'piso'}`)).filter(Boolean).join('; ');
    candidates.push({ R, regime: label || 'livre' });
  }

  if (!candidates.length) {
    if (!positiveDenominator) {
      return { status: 'inviable', reason: 'As taxas percentuais somadas à margem-alvo chegam a 100 % ou mais da receita: nenhum preço atinge essa meta.', denominator: (worstDenominator ?? new D(0)).toDecimalPlaces(6).toFixed() };
    }
    return { status: 'unresolvable', reason: 'Os tetos e pisos das taxas não permitem uma solução verificável: revise os parâmetros.' };
  }
  candidates.sort((x, y) => x.R.cmp(y.R));
  const best = candidates[0]!;
  const multipleRoots = candidates.some((c) => c.R.minus(best.R).abs().gt(EPS));
  const exactUnit = best.R.div(q);

  let priceCents = Math.max(1, roundPrice(exactUnit, rounding));
  let floorApplied = false;
  if (input.floorCents !== null && input.floorCents !== undefined && priceCents < input.floorCents) { priceCents = input.floorCents; floorApplied = true; }

  const judge = (p: number) => {
    const ev = evaluate({ priceCents: p, quantity: q, variableUnitCost: cost, overheadUnit: overhead, fees: input.fees, markupBase: input.markupBase });
    const ratio = ev.revenueCents > 0 ? new D(basis === 'managerial' ? (ev.managerialCents ?? 0) : ev.contributionCents).div(ev.revenueCents) : null;
    return { ev, ratio, meets: ratio !== null && ratio.gte(mr) };
  };
  let judged = judge(priceCents);
  // «para cima» e terminações garantem a meta: se o arredondamento das taxas a centavos deixou a margem um tico abaixo, sobe até atingir.
  let bumped = 0;
  if (rounding === 'up' || rounding === 'charm_90' || rounding === 'charm_99') {
    while (!judged.meets && bumped < 200) { priceCents += rounding === 'up' ? 1 : 100; judged = judge(priceCents); bumped++; }
  }
  const evaluation = judged.ev;
  const achieved = basis === 'managerial' ? evaluation.managerialMarginPct : evaluation.marginPct;
  const achievedRatio = judged.ratio;
  const meetsTarget = judged.meets;
  const shortfallPp = !meetsTarget && achievedRatio !== null ? mr.minus(achievedRatio).mul(100).toDecimalPlaces(4).toFixed(4) : null;
  const steps: Step[] = [
    { key: 'target', label: basis === 'managerial' ? 'Meta de margem gerencial' : 'Meta de margem de contribuição', formula: 'dado de entrada', pct: pctText(mr) },
    { key: 'exact', label: 'Preço exato', formula: '(custos + taxas fixas) ÷ (1 − margem − taxas percentuais)', note: `${exactUnit.toDecimalPlaces(4).toFixed()} centavos (regime: ${best.regime})` },
    { key: 'rounded', label: 'Preço arredondado', formula: `regra «${rounding}»`, cents: priceCents, note: [floorApplied ? 'preço mínimo autorizado aplicado' : '', bumped ? `+${bumped} para compensar o arredondamento das taxas` : ''].filter(Boolean).join('; ') || undefined },
    { key: 'check', label: 'Conferência', formula: 'avaliação direta do preço arredondado', pct: achieved, note: meetsTarget ? 'atinge a meta' : `abaixo da meta por arredondamento (${shortfallPp} p.p.)` },
  ];

  return { status: 'ok', exactPriceCents: exactUnit.toDecimalPlaces(6).toFixed(), priceCents, rounding, evaluation, meetsTarget, achievedMarginPct: achieved, shortfallPp, floorApplied, regime: best.regime, multipleRoots, steps };
}

// Descontos (docs/PRICING_ENGINE.md §6): as taxas são SEMPRE recalculadas sobre o preço final.
import { D, PricingError, dec, priceCentsOf, type DecValue } from './decimal';
import { evaluate } from './evaluate';
import { solvePrice } from './solve';
import type { EvalResult, FeeLine, MarkupBase } from './types';

export type Discount = { percent?: DecValue | null; fixedCents?: number | null };

/** Preço final após o desconto. Percentual em [0, 100); fixo inteiro em centavos, menor que o preço. */
export function applyDiscount(listPriceCents: number, discount: Discount): number {
  const list = priceCentsOf(listPriceCents);
  const hasPercent = discount.percent !== null && discount.percent !== undefined && discount.percent !== '';
  const hasFixed = discount.fixedCents !== null && discount.fixedCents !== undefined;
  if (hasPercent && hasFixed) throw new PricingError('invalid_discount', 'Informe desconto percentual ou fixo, não os dois.');
  if (hasPercent) {
    const p = dec(discount.percent!, 'Desconto');
    if (p.lt(0) || p.gte(100)) throw new PricingError('invalid_discount', 'O desconto percentual deve estar entre 0 % e 100 % (exclusive).');
    return Math.max(1, new D(list).mul(new D(1).minus(p.div(100))).toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber());
  }
  if (hasFixed) {
    const f = discount.fixedCents!;
    if (!Number.isSafeInteger(f) || f < 0) throw new PricingError('invalid_discount', 'O desconto fixo precisa ser um inteiro de centavos, sem negativos.');
    if (f >= list) throw new PricingError('invalid_discount', 'O desconto fixo não pode ser igual ou maior que o preço.');
    return list - f;
  }
  return list;
}

export type DiscountAnalysis = {
  finalPriceCents: number;
  before: EvalResult;
  after: EvalResult;
  contributionDeltaCents: number;
  /** Variação da margem em pontos percentuais (texto, 4 casas) ou null. */
  marginDeltaPp: string | null;
  negativeContribution: boolean;
  belowMinMargin: boolean;
  /** Desconto máximo (%) que ainda respeita a margem mínima; null se indisponível. */
  maxDiscountPct: string | null;
  maxDiscountNote: string | null;
};

export function analyzeDiscount(input: {
  listPriceCents: number; discount: Discount; quantity?: DecValue; variableUnitCost: DecValue; overheadUnit?: DecValue | null; fees: FeeLine[]; markupBase?: MarkupBase;
  minMarginPct?: DecValue | null;
}): DiscountAnalysis {
  const common = { quantity: input.quantity, variableUnitCost: input.variableUnitCost, overheadUnit: input.overheadUnit, fees: input.fees, markupBase: input.markupBase };
  const finalPriceCents = applyDiscount(input.listPriceCents, input.discount);
  const before = evaluate({ ...common, priceCents: input.listPriceCents });
  const after = evaluate({ ...common, priceCents: finalPriceCents });
  const marginDeltaPp = before.marginPct === null || after.marginPct === null ? null : new D(after.marginPct).minus(before.marginPct).toDecimalPlaces(4).toFixed(4);
  let maxDiscountPct: string | null = null;
  let maxDiscountNote: string | null = null;
  if (input.minMarginPct !== null && input.minMarginPct !== undefined) {
    const s = solvePrice({ ...common, targetMarginPct: input.minMarginPct, rounding: 'up' });
    if (s.status === 'ok') {
      const list = new D(input.listPriceCents);
      const room = list.minus(s.priceCents);
      maxDiscountPct = room.lte(0) ? '0.00' : room.div(list).mul(100).toDecimalPlaces(2, D.ROUND_DOWN).toFixed(2);
      if (room.lte(0)) maxDiscountNote = 'O preço de lista já está no limite da margem mínima: não há folga para desconto.';
    } else maxDiscountNote = s.status === 'inviable' ? 'Margem mínima inviável com as taxas atuais.' : 'Não foi possível resolver o desconto máximo com segurança.';
  }
  return {
    finalPriceCents, before, after, contributionDeltaCents: after.contributionCents - before.contributionCents, marginDeltaPp,
    negativeContribution: after.contributionCents < 0,
    belowMinMargin: input.minMarginPct !== null && input.minMarginPct !== undefined && after.marginPct !== null ? new D(after.marginPct).lt(dec(input.minMarginPct, 'Margem mínima')) : false,
    maxDiscountPct, maxDiscountNote,
  };
}

/** Preço por markup sobre o custo-base (docs/PRICING_ENGINE.md §5). Mostre sempre a margem equivalente da avaliação. */
export function priceFromMarkup(baseCost: DecValue, markupPct: DecValue): number {
  const base = dec(baseCost, 'Custo-base');
  const mk = dec(markupPct, 'Markup');
  if (base.lte(0)) throw new PricingError('invalid_cost', 'Custo-base igual a zero: markup não calculável.');
  if (mk.lt(0) || mk.gt(100_000)) throw new PricingError('invalid_margin', 'Markup fora do intervalo permitido.');
  return Math.max(1, base.mul(new D(1).plus(mk.div(100))).toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber());
}

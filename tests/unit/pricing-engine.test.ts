import { describe, expect, it } from 'vitest';
import {
  PricingError, analyzeDiscount, applyDiscount, evaluate, feeSetProblems, priceFromMarkup, roundPrice, solvePrice, D, type FeeLine,
} from '@/lib/pricing/engine';

const pct = (id: string, ratePct: number, basis: 'price' | 'net_price' | 'cost' = 'price', extra: Partial<FeeLine> = {}): FeeLine => ({ id, name: id, kind: 'commission', basis, ratePct, ...extra });
const fixed = (id: string, fixedCents: number, basis: 'fixed_unit' | 'fixed_transaction' = 'fixed_unit'): FeeLine => ({ id, name: id, kind: 'transaction', basis, fixedCents });

describe('F1 · exemplo obrigatório do prompt: R$ 50,00, taxa 15 %, margem 25 %', () => {
  const base = { variableUnitCost: 5000, fees: [pct('taxa', 15)], targetMarginPct: 25 };
  it('arredondamento padrão: R$ 83,33, taxa R$ 12,50, contribuição R$ 20,83, margem ≈ 25 % (avisa o desvio)', () => {
    const r = solvePrice(base);
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(8333);
    expect(Number(r.exactPriceCents)).toBeCloseTo(8333.333333, 5);
    expect(r.evaluation.revenueCents).toBe(8333);
    expect(r.evaluation.fees[0]!.amountCents).toBe(1250); // 1249,95 → 1250
    expect(r.evaluation.contributionCents).toBe(2083);
    expect(r.evaluation.marginPct).toBe('24.9970');
    expect(r.meetsTarget).toBe(false);
    expect(r.shortfallPp).toBe('0.0030');
  });
  it('arredondando para cima garante a meta: R$ 83,34, contribuição R$ 20,84, margem 25,006 %', () => {
    const r = solvePrice({ ...base, rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(8334);
    expect(r.evaluation.contributionCents).toBe(2084);
    expect(r.evaluation.marginPct).toBe('25.0060');
    expect(r.meetsTarget).toBe(true);
    expect(r.shortfallPp).toBeNull();
  });
});

describe('F2 · equilíbrio unitário', () => {
  it('(50 + 1) ÷ 0,85 = R$ 60,00 exato, contribuição zero', () => {
    const r = solvePrice({ variableUnitCost: 5000, fees: [pct('t', 15), fixed('f', 100)], targetMarginPct: 0, rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(6000);
    expect(r.evaluation.fees.map((f) => f.amountCents)).toEqual([900, 100]);
    expect(r.evaluation.contributionCents).toBe(0);
    expect(r.meetsTarget).toBe(true);
  });
});

describe('F3 · cenário inviável nunca devolve preço', () => {
  it.each([[80, 25], [75, 25], [100, 0], [99.99, 0.01]])('taxa %s %% + margem %s %%', (fee, margin) => {
    const r = solvePrice({ variableUnitCost: 5000, fees: [pct('t', fee)], targetMarginPct: margin });
    expect(r.status).toBe('inviable');
    expect('priceCents' in r).toBe(false);
  });
});

describe('F4 · taxa sobre preço líquido', () => {
  it('plataforma 10 % sobre o preço + imposto informado 8 % sobre o líquido, margem 20 %', () => {
    const r = solvePrice({ variableUnitCost: 5000, fees: [pct('plat', 10), pct('imp', 8, 'net_price')], targetMarginPct: 20 });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(Number(r.exactPriceCents)).toBeCloseTo(5000 / 0.628, 4);
    expect(r.priceCents).toBe(7962);
    const imposto = r.evaluation.fees.find((f) => f.id === 'imp')!.amountCents;
    expect(imposto).toBe(Math.round(0.08 * (7962 - Math.round(0.1 * 7962)))); // 8 % de (7962 − 796)
  });
});

describe('F5 · taxa com teto (linear por partes)', () => {
  it('comissão 10 % com teto de R$ 5,00 e margem 20 % → R$ 68,75 exatos', () => {
    const r = solvePrice({ variableUnitCost: 5000, fees: [pct('com', 10, 'price', { maxCents: 500 })], targetMarginPct: 20 });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(6875);
    expect(r.regime).toContain('teto');
    expect(r.evaluation.fees[0]).toMatchObject({ amountCents: 500, capped: 'max' });
    expect(r.evaluation.contributionCents).toBe(1375);
    expect(r.meetsTarget).toBe(true);
  });
  it('com piso: taxa 2 % com mínimo R$ 3,00 num item barato usa o piso', () => {
    const r = solvePrice({ variableUnitCost: 1000, fees: [pct('pag', 2, 'price', { minCents: 300 })], targetMarginPct: 10, rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.evaluation.fees[0]!.capped).toBe('min');
    expect(r.priceCents).toBe(1445); // (1000 + 300) ÷ 0,9 = 1444,44 → 1445
    expect(r.meetsTarget).toBe(true);
  });
  it('teto que torna viável um cenário inviável sem teto', () => {
    const fees = [pct('c', 80, 'price', { maxCents: 1000 })];
    const r = solvePrice({ variableUnitCost: 5000, fees, targetMarginPct: 25, rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.evaluation.fees[0]!.amountCents).toBe(1000);
    expect(r.priceCents).toBe(8000); // (5000 + 1000) ÷ 0,75
  });
  it('mais de 8 taxas limitadas não é resolvido', () => {
    const fees = Array.from({ length: 9 }, (_, i) => pct(`t${i}`, 1, 'price', { maxCents: 100 }));
    expect(solvePrice({ variableUnitCost: 1000, fees, targetMarginPct: 10 }).status).toBe('unresolvable');
  });
});

describe('F6 · markup não é margem', () => {
  it('markup de 60 % sobre R$ 50,00 = R$ 80,00 → margem 37,5 %', () => {
    const price = priceFromMarkup(5000, 60);
    expect(price).toBe(8000);
    const ev = evaluate({ priceCents: price, variableUnitCost: 5000, fees: [] });
    expect(ev.markupPct).toBe('60.0000');
    expect(ev.marginPct).toBe('37.5000');
  });
  it('custo-base completo muda a base do markup', () => {
    const ev = evaluate({ priceCents: 8000, variableUnitCost: 5000, overheadUnit: 1000, fees: [], markupBase: 'full_cost' });
    expect(ev.markupBaseUnitCents).toBe('6000');
    expect(ev.markupPct).toBe('33.3333');
  });
});

describe('F7 · desconto: taxas recalculadas sobre o preço final', () => {
  const common = { listPriceCents: 10000, variableUnitCost: 6000, fees: [pct('t', 10)] };
  it('10 % de desconto: contribuição 3000 → 2100, margem 30 % → 23,33 %', () => {
    const a = analyzeDiscount({ ...common, discount: { percent: 10 }, minMarginPct: 20 });
    expect(a.finalPriceCents).toBe(9000);
    expect(a.before.contributionCents).toBe(3000);
    expect(a.before.marginPct).toBe('30.0000');
    expect(a.after.fees[0]!.amountCents).toBe(900);
    expect(a.after.contributionCents).toBe(2100);
    expect(a.after.marginPct).toBe('23.3333');
    expect(a.contributionDeltaCents).toBe(-900);
    expect(a.marginDeltaPp).toBe('-6.6667');
    expect(a.negativeContribution).toBe(false);
    expect(a.belowMinMargin).toBe(false);
    expect(a.maxDiscountPct).toBe('14.28');
  });
  it('desconto que zera a margem mínima ou fica negativo é sinalizado', () => {
    const a = analyzeDiscount({ ...common, discount: { percent: 50 }, minMarginPct: 20 });
    expect(a.negativeContribution).toBe(true);
    expect(a.belowMinMargin).toBe(true);
  });
  it('desconto fixo e validações', () => {
    expect(applyDiscount(10000, { fixedCents: 1500 })).toBe(8500);
    expect(() => applyDiscount(10000, { percent: 100 })).toThrow(PricingError);
    expect(() => applyDiscount(10000, { percent: 120 })).toThrow(PricingError);
    expect(() => applyDiscount(10000, { percent: -1 })).toThrow(PricingError);
    expect(() => applyDiscount(10000, { fixedCents: 10000 })).toThrow(PricingError);
    expect(() => applyDiscount(10000, { fixedCents: 1.5 })).toThrow(PricingError);
    expect(() => applyDiscount(10000, { percent: 5, fixedCents: 100 })).toThrow(PricingError);
    expect(applyDiscount(10000, {})).toBe(10000);
  });
  it('sem folga: preço de lista já no limite da margem mínima', () => {
    const a = analyzeDiscount({ ...common, listPriceCents: 7000, discount: { percent: 1 }, minMarginPct: 20 });
    expect(a.maxDiscountPct).toBe('0.00');
    expect(a.maxDiscountNote).toContain('não há folga');
  });
});

describe('F8 · custo-base zero', () => {
  it('markup não calculável, margem calculável; markup por percentual recusa base zero', () => {
    const ev = evaluate({ priceCents: 1000, variableUnitCost: 0, fees: [] });
    expect(ev.markupPct).toBeNull();
    expect(ev.marginPct).toBe('100.0000');
    expect(() => priceFromMarkup(0, 50)).toThrow(PricingError);
  });
});

describe('F9 · quantidade e taxa fixa por transação', () => {
  it('10 un × R$ 25,00, custo R$ 10,00/un., fixo R$ 5,00 por transação', () => {
    const ev = evaluate({ priceCents: 2500, quantity: 10, variableUnitCost: 1000, fees: [fixed('f', 500, 'fixed_transaction')] });
    expect(ev.revenueCents).toBe(25000);
    expect(ev.variableCostCents).toBe(10000);
    expect(ev.totalFeesCents).toBe(500);
    expect(ev.contributionCents).toBe(14500);
    expect(ev.contributionUnitCents).toBe('1450');
  });
  it('o solver com quantidade divide o fixo por transação entre as unidades', () => {
    const r = solvePrice({ variableUnitCost: 1000, quantity: 10, fees: [fixed('f', 500, 'fixed_transaction')], targetMarginPct: 0, rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(1050); // (10000 + 500) ÷ 10
    expect(r.evaluation.contributionCents).toBe(0);
  });
});

describe('F10 · rateio e resultado gerencial', () => {
  it('aluguel R$ 3.000,00 ÷ 1.500 un. = R$ 2,00 por unidade; resultado gerencial = contribuição − rateio', () => {
    const ev = evaluate({ priceCents: 8334, variableUnitCost: 5000, overheadUnit: 200, fees: [pct('t', 15)] });
    expect(ev.contributionCents).toBe(2084);
    expect(ev.overheadCents).toBe(200);
    expect(ev.managerialCents).toBe(1884);
  });
  it('meta de margem gerencial inclui o rateio como custo', () => {
    const r = solvePrice({ variableUnitCost: 5000, overheadUnit: 1000, fees: [pct('t', 15)], targetMarginPct: 20, targetBasis: 'managerial', rounding: 'up' });
    if (r.status !== 'ok') throw new Error('esperava ok');
    // 6000 ÷ 0,65 = 9230,77 → 9231, mas aí a taxa (1384,65 → 1385) deixa o resultado em 1846 < 20 % de 9231 (1846,2): sobe 1 centavo
    expect(r.priceCents).toBe(9232);
    expect(r.evaluation.fees[0]!.amountCents).toBe(1385);
    expect(r.evaluation.managerialCents).toBe(1847); // 9232 − 5000 − 1385 − 1000
    expect(r.meetsTarget).toBe(true);
  });
});

describe('arredondamentos do preço', () => {
  it.each([
    ['nearest', '8333.5', 8334], ['nearest', '8333.49', 8333], ['up', '8333.01', 8334], ['down', '8333.99', 8333],
    ['charm_90', '8333.2', 8390], ['charm_90', '8391', 8490], ['charm_90', '8390', 8390], ['charm_99', '8333.2', 8399], ['charm_99', '50', 99],
  ] as const)('%s de %s → %s', (rule, exact, expected) => {
    expect(roundPrice(new D(exact), rule)).toBe(expected);
  });
  it('preço mínimo autorizado vira piso', () => {
    const r = solvePrice({ variableUnitCost: 1000, fees: [], targetMarginPct: 10, floorCents: 5000 });
    if (r.status !== 'ok') throw new Error('esperava ok');
    expect(r.priceCents).toBe(5000);
    expect(r.floorApplied).toBe(true);
  });
});

describe('validações', () => {
  it('margem-alvo fora de [0, 100) e entradas inválidas', () => {
    expect(() => solvePrice({ variableUnitCost: 5000, fees: [], targetMarginPct: 100 })).toThrow(PricingError);
    expect(() => solvePrice({ variableUnitCost: 5000, fees: [], targetMarginPct: -1 })).toThrow(PricingError);
    expect(() => solvePrice({ variableUnitCost: 5000, fees: [], targetMarginPct: 'abc' })).toThrow(PricingError);
    expect(() => solvePrice({ variableUnitCost: -1, fees: [], targetMarginPct: 10 })).toThrow(PricingError);
    expect(() => solvePrice({ variableUnitCost: 5000, fees: [], targetMarginPct: 10, targetBasis: 'managerial' })).toThrow(PricingError);
    expect(() => evaluate({ priceCents: 0, variableUnitCost: 1, fees: [] })).toThrow(PricingError);
    expect(() => evaluate({ priceCents: 10.5, variableUnitCost: 1, fees: [] })).toThrow(PricingError);
    expect(() => evaluate({ priceCents: 100, quantity: 0, variableUnitCost: 1, fees: [] })).toThrow(PricingError);
    expect(() => evaluate({ priceCents: 100, variableUnitCost: Number.NaN, fees: [] })).toThrow(PricingError);
  });
  it('taxas inválidas', () => {
    const bad = (fee: FeeLine) => expect(() => evaluate({ priceCents: 100, variableUnitCost: 1, fees: [fee] })).toThrow(PricingError);
    bad(pct('a', 101)); bad(pct('a', -1)); bad({ id: 'a', name: 'a', kind: 'other', basis: 'price' });
    bad({ id: 'a', name: 'a', kind: 'other', basis: 'fixed_unit', fixedCents: -5 });
    bad({ id: 'a', name: 'a', kind: 'other', basis: 'fixed_unit', fixedCents: 5, maxCents: 10 });
    bad({ id: 'a', name: 'a', kind: 'other', basis: 'price', ratePct: 5, fixedCents: 5 });
    bad(pct('a', 5, 'price', { minCents: 10, maxCents: 5 }));
    expect(() => evaluate({ priceCents: 100, variableUnitCost: 1, fees: [pct('a', 1), pct('a', 2)] })).toThrow(PricingError);
  });
  it('conjunto de taxas que consome 100 % do preço é sinalizado no cadastro', () => {
    expect(feeSetProblems([pct('a', 60), pct('b', 40)])).toHaveLength(1);
    expect(feeSetProblems([pct('a', 60), pct('b', 30)])).toHaveLength(0);
  });
});

describe('propriedades (sementes fixas)', () => {
  // gerador determinístico simples (LCG): os mesmos números em toda execução
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rnd = lcg(20261014);
  const cases = Array.from({ length: 300 }, () => {
    const nFees = 1 + Math.floor(rnd() * 3);
    const fees: FeeLine[] = [];
    let priceSum = 0;
    for (let i = 0; i < nFees; i++) {
      const r = Math.round(rnd() * 12 * 100) / 100;
      priceSum += r;
      fees.push(pct(`p${i}`, r, i === 2 ? 'net_price' : 'price'));
    }
    if (rnd() < 0.5) fees.push(fixed('fx', Math.floor(rnd() * 300)));
    return { cost: Math.floor(rnd() * 90000) + 100, fees, margin: Math.round(rnd() * 40 * 100) / 100, priceSum };
  });
  it('com arredondamento para cima: atinge a meta e 1 centavo a menos NÃO atinge (preço mínimo)', () => {
    for (const c of cases) {
      const r = solvePrice({ variableUnitCost: c.cost, fees: c.fees, targetMarginPct: c.margin, rounding: 'up' });
      if (r.status !== 'ok') continue;
      const target = new D(c.margin).div(100);
      // meta atendida na avaliação direta (tolerância de arredondamento de taxas: 1 centavo por linha)
      const slack = new D(c.fees.length + 1).div(r.evaluation.revenueCents);
      expect(new D(r.evaluation.contributionCents).div(r.evaluation.revenueCents).gte(target.minus(slack))).toBe(true);
      if (r.priceCents > 2) {
        const below = evaluate({ priceCents: r.priceCents - 2, variableUnitCost: c.cost, fees: c.fees });
        expect(new D(below.contributionCents).div(below.revenueCents).lt(target.plus(slack))).toBe(true);
      }
    }
  });
  it('nunca devolve preço quando as taxas sobre preço + meta chegam a 100 %', () => {
    for (const c of cases) {
      const r = solvePrice({ variableUnitCost: c.cost, fees: [pct('x', 99.5)], targetMarginPct: Math.max(0.5, c.margin) });
      expect(r.status).toBe('inviable');
    }
  });
  it('é determinístico: duas execuções dão o mesmo resultado', () => {
    for (const c of cases.slice(0, 50)) {
      const a = solvePrice({ variableUnitCost: c.cost, fees: c.fees, targetMarginPct: c.margin });
      const b = solvePrice({ variableUnitCost: c.cost, fees: c.fees, targetMarginPct: c.margin });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
  it('margem e markup nunca coincidem quando há custo e preço diferentes de zero', () => {
    for (const c of cases.slice(0, 50)) {
      const ev = evaluate({ priceCents: c.cost * 2, variableUnitCost: c.cost, fees: [] });
      expect(ev.marginPct).toBe('50.0000');
      expect(ev.markupPct).toBe('100.0000');
    }
  });
});

describe('arredondamento de centavos na fronteira (meio-para-cima)', () => {
  it('custo variável e rateio com fração de centavo arredondam para cima a partir de 0,5', () => {
    const r = evaluate({ priceCents: 10000, variableUnitCost: '33.5', overheadUnit: '10.5', quantity: 1, fees: [] });
    expect(r.variableCostCents).toBe(34);
    expect(r.overheadCents).toBe(11);
    const r2 = evaluate({ priceCents: 10000, variableUnitCost: '12.4', quantity: 3, fees: [] });
    expect(r2.variableCostCents).toBe(37); // 37,2 → 37
  });
});

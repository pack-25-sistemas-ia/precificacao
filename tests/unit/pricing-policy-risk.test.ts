import { describe, expect, it } from 'vitest';
import { PricingError, classifyRisk, evaluate, resolvePolicy, validatePolicyRules, type PolicyAssignment, type PolicyRules } from '@/lib/pricing/engine';

const rules = (target: string, extra: Partial<PolicyRules> = {}): PolicyRules => ({ targetMarginPct: target, minimumMarginPct: '10', maxDiscountPct: null, rounding: 'nearest', minPriceCents: null, ...extra });
const asg = (id: string, scope: Partial<PolicyAssignment>, target = '30'): PolicyAssignment => ({ id, policyId: `p-${id}`, rules: rules(target), ...scope });

describe('validação de políticas', () => {
  it('margens, desconto máximo, arredondamento e piso', () => {
    expect(validatePolicyRules(rules('30'))).toMatchObject({ targetMarginPct: '30', minimumMarginPct: '10' });
    expect(() => validatePolicyRules(rules('100'))).toThrow(PricingError);
    expect(() => validatePolicyRules(rules('-1'))).toThrow(PricingError);
    expect(() => validatePolicyRules(rules('5', { minimumMarginPct: '10' }))).toThrow(PricingError); // mínima > alvo
    expect(() => validatePolicyRules(rules('30', { maxDiscountPct: '100' }))).toThrow(PricingError);
    expect(() => validatePolicyRules(rules('30', { minPriceCents: 1.5 }))).toThrow(PricingError);
    expect(() => validatePolicyRules(rules('30', { rounding: 'banker' as never }))).toThrow(PricingError);
  });
});

describe('precedência das regras (D-P10)', () => {
  const ctx = { itemId: 'i1', categoryId: 'c1', channelId: 'ch1', date: '2026-10-14' };
  it('a mais específica vence, na ordem documentada', () => {
    const all = [
      asg('glob', {}), asg('canal', { channelId: 'ch1' }), asg('cat', { categoryId: 'c1' }), asg('cat-canal', { categoryId: 'c1', channelId: 'ch1' }),
      asg('item', { itemId: 'i1' }), asg('item-canal', { itemId: 'i1', channelId: 'ch1' }),
    ];
    const order = ['item-canal', 'item', 'cat-canal', 'cat', 'canal', 'glob'];
    let pool = all;
    for (const expected of order) {
      const r = resolvePolicy(pool, ctx)!;
      expect(r.assignment.id).toBe(expected);
      pool = pool.filter((a) => a.id !== expected);
    }
    expect(resolvePolicy([], ctx)).toBeNull();
  });
  it('escopo de outro item, categoria ou canal não se aplica', () => {
    const pool = [asg('outro-item', { itemId: 'i2' }), asg('outra-cat', { categoryId: 'c2' }), asg('outro-canal', { channelId: 'ch2' })];
    expect(resolvePolicy(pool, ctx)).toBeNull();
    expect(resolvePolicy([asg('canal', { channelId: 'ch1' })], { itemId: 'i1', date: '2026-10-14' })).toBeNull(); // sem canal no contexto
  });
  it('vigência por datas (inclusiva) escolhe a política certa', () => {
    const pool = [asg('velha', { validUntil: '2026-06-30' }, '20'), asg('nova', { validFrom: '2026-07-01' }, '35')];
    expect(resolvePolicy(pool, { ...ctx, date: '2026-06-30' })!.assignment.id).toBe('velha');
    expect(resolvePolicy(pool, { ...ctx, date: '2026-07-01' })!.assignment.id).toBe('nova');
    expect(() => resolvePolicy(pool, { ...ctx, date: '14/10/2026' })).toThrow(PricingError);
  });
  it('duas vigentes no mesmo escopo = conflito explícito, nunca soma', () => {
    const pool = [asg('a', { channelId: 'ch1' }), asg('b', { channelId: 'ch1' })];
    try { resolvePolicy(pool, ctx); expect.unreachable(); } catch (e) { expect((e as PricingError).code).toBe('policy_conflict'); }
  });
  it('atribuição com item e categoria é inválida', () => {
    expect(() => resolvePolicy([asg('x', { itemId: 'i1', categoryId: 'c1' })], ctx)).toThrow(PricingError);
  });
});

describe('classificação de risco', () => {
  const policy = { targetMarginPct: '30', minimumMarginPct: '10' };
  const ev = (price: number, overheadUnit?: number) => evaluate({ priceCents: price, variableUnitCost: 6000, overheadUnit, fees: [{ id: 't', name: 't', kind: 'commission', basis: 'price', ratePct: 10 }] });
  const base = { costComplete: true, hasPrice: true, ruleInvalid: false, policy };

  it('ordem: custo incompleto > regra inválida > sem preço > contribuição negativa', () => {
    expect(classifyRisk({ ...base, costComplete: false, evaluation: null }).state).toBe('incomplete_cost');
    expect(classifyRisk({ ...base, ruleInvalid: true, evaluation: ev(10000) }).state).toBe('invalid_rule');
    expect(classifyRisk({ ...base, hasPrice: false, evaluation: null }).state).toBe('no_price');
    expect(classifyRisk({ ...base, evaluation: ev(6000) }).state).toBe('negative_contribution'); // 6000 − 6000 − 600
  });
  it('equilíbrio gerencial (cobre custos e taxas, mas não o rateio)', () => {
    expect(classifyRisk({ ...base, evaluation: ev(7000, 400) }).state).toBe('below_break_even'); // contribuição 300 − rateio 400 = −100
  });
  it('faixas de margem', () => {
    expect(classifyRisk({ ...base, evaluation: ev(7000) }).state).toBe('below_target'); // 300/7000 = 4,3 % < 10 %
    expect(classifyRisk({ ...base, evaluation: ev(8000) }).state).toBe('needs_review'); // 1200/8000 = 15 % entre 10 e 30
    const ok = classifyRisk({ ...base, evaluation: ev(10000) }); // 3400/10000 = 34 %
    expect(ok.state).toBe('within_target');
    expect(ok.reasons).toEqual([]);
    expect(classifyRisk({ ...base, evaluation: ev(10000), daysSincePriceReview: 120 }).state).toBe('needs_review');
    expect(classifyRisk({ ...base, evaluation: ev(10000), daysSincePriceReview: 30 }).state).toBe('within_target');
  });
});

import { describe, expect, it } from 'vitest';
import { PricingError, costVariation, directUnitCost, summarizeCosts, type CostComponentInput } from '@/lib/pricing/engine';

const direct = (id: string, amountCents: number | null | undefined, extra: Partial<CostComponentInput> = {}): CostComponentInput => ({ id, kind: 'acquisition', costClass: 'direct', amountCents, ...extra });
const overhead = (id: string, extra: Partial<CostComponentInput>): CostComponentInput => ({ id, kind: 'allocated_overhead', costClass: 'overhead', amountCents: null, ...extra });

describe('custo direto unitário', () => {
  it('exemplo do prompt: lote de 100 un. por R$ 2.000,00 + embalagem R$ 2,00 = R$ 22,00 por unidade', () => {
    const s = summarizeCosts([direct('compra', 200000, { quantity: 100 }), direct('emb', 200, { kind: 'packaging' })]);
    expect(s.status).toBe('complete');
    expect(s.directUnitCents).toBe('2200');
    expect(s.overheadStatus).toBe('none');
    expect(s.fullUnitCents).toBe('2200');
    expect(s.lines.map((l) => l.sharePct)).toEqual(['90.91', '9.09']);
  });
  it('mão de obra: R$ 80,00/h × 2,5 h = R$ 200,00; fração de centavo é preservada', () => {
    expect(directUnitCost(8000, 1, 2.5).toString()).toBe('20000');
    expect(directUnitCost(100, 8000).toFixed(6)).toBe('0.012500');
  });
  it('componentes inativos não entram', () => {
    const s = summarizeCosts([direct('a', 1000), direct('b', 9999, { active: false })]);
    expect(s.directUnitCents).toBe('1000');
  });
});

describe('custo desconhecido NÃO é zero (D-P6)', () => {
  it('componente sem valor deixa o item incompleto e aponta qual', () => {
    const s = summarizeCosts([direct('compra', 1000), direct('frete', null, { name: 'Frete' }), direct('x', undefined)]);
    expect(s.status).toBe('incomplete');
    expect(s.directUnitCents).toBeNull();
    expect(s.fullUnitCents).toBeNull();
    expect(s.issues.filter((i) => i.code === 'unknown_cost').map((i) => i.componentId)).toEqual(['frete', 'x']);
    expect(s.issues[0]!.message).toContain('desconhecido, não zero');
  });
  it('item sem nenhum componente direto é incompleto (sem custo)', () => {
    const s = summarizeCosts([]);
    expect(s.status).toBe('incomplete');
    expect(s.issues[0]!.code).toBe('no_cost');
    expect(summarizeCosts([overhead('a', { amountCents: 100, quantity: 10, allocationMethod: 'volume' })]).status).toBe('incomplete');
  });
  it('zero digitado é zero conhecido', () => {
    const s = summarizeCosts([direct('brinde', 0)]);
    expect(s.status).toBe('complete');
    expect(s.directUnitCents).toBe('0');
  });
});

describe('rateio de estrutura', () => {
  const base = [direct('compra', 5000)];
  it('volume: aluguel R$ 3.000,00 ÷ 1.500 un. = R$ 2,00/un.', () => {
    const s = summarizeCosts([...base, overhead('aluguel', { amountCents: 300000, quantity: 1500, allocationMethod: 'volume' })]);
    expect(s.overheadStatus).toBe('known');
    expect(s.overheadUnitCents).toBe('200');
    expect(s.fullUnitCents).toBe('5200');
  });
  it('horas: R$ 6.000,00 ÷ 120 h × 2 h = R$ 100,00', () => {
    const s = summarizeCosts([...base, overhead('equipe', { amountCents: 600000, quantity: 120, usage: 2, allocationMethod: 'hours' })]);
    expect(s.overheadUnitCents).toBe('10000');
  });
  it('percentual do custo direto e manual por unidade', () => {
    expect(summarizeCosts([...base, overhead('adm', { usage: 5, allocationMethod: 'percent' })]).overheadUnitCents).toBe('250');
    expect(summarizeCosts([...base, overhead('fixo', { amountCents: 123, allocationMethod: 'manual' })]).overheadUnitCents).toBe('123');
  });
  it('parâmetro faltando = rateio desconhecido; contribuição segue calculável, resultado gerencial não', () => {
    const s = summarizeCosts([...base, overhead('aluguel', { amountCents: 300000, allocationMethod: 'volume' })]);
    expect(s.status).toBe('complete');
    expect(s.directUnitCents).toBe('5000');
    expect(s.overheadStatus).toBe('unknown');
    expect(s.overheadUnitCents).toBeNull();
    expect(s.fullUnitCents).toBeNull();
    expect(s.issues[0]!.code).toBe('unknown_overhead');
    const zero = summarizeCosts([...base, overhead('aluguel', { amountCents: 300000, quantity: 0, allocationMethod: 'volume' })]);
    expect(zero.overheadStatus).toBe('unknown');
  });
});

describe('validações e variação', () => {
  it('quantidade ≤ 0, consumo ≤ 0 e valor negativo são recusados', () => {
    expect(() => directUnitCost(100, 0)).toThrow(PricingError);
    expect(() => directUnitCost(100, 1, 0)).toThrow(PricingError);
    expect(() => directUnitCost(-1, 1)).toThrow(PricingError);
    expect(() => directUnitCost('abc', 1)).toThrow(PricingError);
  });
  it('variação entre versões', () => {
    expect(costVariation(2200, 2420)).toEqual({ deltaCents: '220', deltaPct: '10.0000' });
    expect(costVariation(0, 100).deltaPct).toBeNull();
  });
});

// Regras comerciais como DADOS validados (docs/MARGIN_RULES.md, D-P10): precedência por especificidade, vigência por datas,
// conflito é erro (nunca soma nem sobrescreve em silêncio). Nada aqui executa código fornecido por usuário.
import { D, PricingError, dec } from './decimal';
import type { RoundingRule } from './types';

export type PolicyRules = {
  targetMarginPct: string;
  minimumMarginPct: string;
  maxDiscountPct: string | null;
  rounding: RoundingRule;
  minPriceCents: number | null;
};

export type PolicyScope = 'item_channel' | 'item' | 'category_channel' | 'category' | 'channel' | 'global';
export const SCOPE_ORDER: readonly PolicyScope[] = ['item_channel', 'item', 'category_channel', 'category', 'channel', 'global'];
export const SCOPE_LABELS: Record<PolicyScope, string> = {
  item_channel: 'Item e canal', item: 'Item', category_channel: 'Categoria e canal', category: 'Categoria', channel: 'Canal', global: 'Regra global',
};

export type PolicyAssignment = {
  id: string;
  policyId: string;
  itemId?: string | null;
  categoryId?: string | null;
  channelId?: string | null;
  /** AAAA-MM-DD, inclusive. null = sem limite. */
  validFrom?: string | null;
  validUntil?: string | null;
  rules: PolicyRules;
};

const ROUNDINGS: readonly RoundingRule[] = ['nearest', 'up', 'down', 'charm_90', 'charm_99'];

export function validatePolicyRules(rules: PolicyRules): PolicyRules {
  const target = dec(rules.targetMarginPct, 'Margem-alvo');
  const min = dec(rules.minimumMarginPct, 'Margem mínima');
  if (min.lt(0) || target.lt(0) || target.gte(100)) throw new PricingError('invalid_policy', 'As margens devem estar entre 0 % e 100 % (exclusive).');
  if (min.gt(target)) throw new PricingError('invalid_policy', 'A margem mínima não pode superar a margem-alvo.');
  if (rules.maxDiscountPct !== null) {
    const d = dec(rules.maxDiscountPct, 'Desconto máximo');
    if (d.lt(0) || d.gte(100)) throw new PricingError('invalid_policy', 'O desconto máximo deve estar entre 0 % e 100 % (exclusive).');
  }
  if (!ROUNDINGS.includes(rules.rounding)) throw new PricingError('invalid_policy', 'Regra de arredondamento inválida.');
  if (rules.minPriceCents !== null && (!Number.isSafeInteger(rules.minPriceCents) || rules.minPriceCents < 0)) throw new PricingError('invalid_policy', 'O preço mínimo autorizado precisa ser um inteiro de centavos.');
  return { ...rules, targetMarginPct: new D(target).toFixed(), minimumMarginPct: new D(min).toFixed() };
}

export function assignmentScope(a: Pick<PolicyAssignment, 'itemId' | 'categoryId' | 'channelId'>): PolicyScope {
  const item = !!a.itemId; const cat = !!a.categoryId; const ch = !!a.channelId;
  if (item && cat) throw new PricingError('invalid_policy', 'Uma atribuição não pode ter item e categoria ao mesmo tempo.');
  if (item) return ch ? 'item_channel' : 'item';
  if (cat) return ch ? 'category_channel' : 'category';
  return ch ? 'channel' : 'global';
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const inRange = (a: PolicyAssignment, date: string) => (!a.validFrom || a.validFrom <= date) && (!a.validUntil || date <= a.validUntil);

export type ResolvedPolicy = { assignment: PolicyAssignment; scope: PolicyScope };

/** Resolve a política de um item × canal numa data: a atribuição vigente mais específica. Mais de uma no mesmo nível → erro de conflito. */
export function resolvePolicy(assignments: readonly PolicyAssignment[], ctx: { itemId: string; categoryId?: string | null; channelId?: string | null; date: string }): ResolvedPolicy | null {
  if (!isoDay.test(ctx.date)) throw new PricingError('invalid_policy', 'Data de referência inválida.');
  const applicable = assignments.filter((a) => {
    const scope = assignmentScope(a);
    if (!inRange(a, ctx.date)) return false;
    if (scope === 'item_channel') return a.itemId === ctx.itemId && !!ctx.channelId && a.channelId === ctx.channelId;
    if (scope === 'item') return a.itemId === ctx.itemId;
    if (scope === 'category_channel') return !!ctx.categoryId && a.categoryId === ctx.categoryId && !!ctx.channelId && a.channelId === ctx.channelId;
    if (scope === 'category') return !!ctx.categoryId && a.categoryId === ctx.categoryId;
    if (scope === 'channel') return !!ctx.channelId && a.channelId === ctx.channelId;
    return true;
  });
  for (const scope of SCOPE_ORDER) {
    const hits = applicable.filter((a) => assignmentScope(a) === scope);
    if (hits.length > 1) throw new PricingError('policy_conflict', `Conflito de regras no escopo «${SCOPE_LABELS[scope]}»: ${hits.length} políticas vigentes na mesma data.`);
    if (hits.length === 1) return { assignment: hits[0]!, scope };
  }
  return null;
}

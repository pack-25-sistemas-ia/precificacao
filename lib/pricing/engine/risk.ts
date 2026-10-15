// Classificação de risco de preço (docs/MARGIN_RULES.md): fórmulas transparentes, sem pontuação inventada.
import { D } from './decimal';
import type { PolicyRules } from './policy';
import type { EvalResult } from './types';

export type RiskState =
  | 'within_target' | 'below_target' | 'negative_contribution' | 'below_break_even' | 'incomplete_cost' | 'invalid_rule' | 'needs_review' | 'no_price';

export const RISK_LABELS: Record<RiskState, string> = {
  within_target: 'Dentro da meta',
  below_target: 'Abaixo da meta',
  negative_contribution: 'Margem de contribuição negativa',
  below_break_even: 'Preço de equilíbrio não atingido',
  incomplete_cost: 'Custo incompleto',
  invalid_rule: 'Regra inválida',
  needs_review: 'Necessita revisão',
  no_price: 'Sem preço',
};

export type RiskInput = {
  costComplete: boolean;
  /** Avaliação do preço atual; null quando não há preço atual ou o cálculo não foi possível. */
  evaluation: EvalResult | null;
  hasPrice: boolean;
  /** Regra/taxas inválidas (inviável, não resolvível ou erro de validação). */
  ruleInvalid: boolean;
  policy: Pick<PolicyRules, 'targetMarginPct' | 'minimumMarginPct'>;
  daysSincePriceReview?: number | null;
  reviewAfterDays?: number;
};

export type RiskResult = { state: RiskState; label: string; reasons: string[] };

export function classifyRisk(input: RiskInput): RiskResult {
  const out = (state: RiskState, reasons: string[]): RiskResult => ({ state, label: RISK_LABELS[state], reasons });
  if (!input.costComplete) return out('incomplete_cost', ['Faltam componentes de custo: o preço não pode ser avaliado.']);
  if (input.ruleInvalid) return out('invalid_rule', ['As taxas e a margem tornam o cálculo inviável ou não verificável.']);
  if (!input.hasPrice || !input.evaluation) return out('no_price', ['O item ainda não tem preço atual neste canal.']);
  const ev = input.evaluation;
  if (ev.contributionCents < 0) return out('negative_contribution', ['A contribuição unitária é negativa no preço atual.']);
  if (ev.managerialCents !== null && ev.managerialCents < 0) return out('below_break_even', ['O preço cobre custos variáveis e taxas, mas não o rateio de estrutura (resultado gerencial negativo).']);
  const margin = ev.marginPct === null ? null : new D(ev.marginPct);
  if (margin === null) return out('invalid_rule', ['Receita não positiva: margem não calculável.']);
  if (margin.lt(input.policy.minimumMarginPct)) return out('below_target', [`Margem ${ev.marginPct} % abaixo da mínima (${input.policy.minimumMarginPct} %).`]);
  if (margin.lt(input.policy.targetMarginPct)) return out('needs_review', [`Margem ${ev.marginPct} % entre a mínima e a meta (${input.policy.targetMarginPct} %).`]);
  const limit = input.reviewAfterDays ?? 90;
  if (input.daysSincePriceReview !== null && input.daysSincePriceReview !== undefined && input.daysSincePriceReview > limit) return out('needs_review', [`Preço sem revisão há mais de ${limit} dias.`]);
  return out('within_target', []);
}

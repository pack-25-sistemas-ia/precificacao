import type { DecValue } from './decimal';

export type FeeBasis = 'price' | 'net_price' | 'cost' | 'fixed_unit' | 'fixed_transaction';
export type FeeKind = 'commission' | 'payment' | 'platform' | 'shipping_subsidy' | 'transaction' | 'tax' | 'other';
export type RoundingRule = 'nearest' | 'up' | 'down' | 'charm_90' | 'charm_99';
export type MarkupBase = 'variable_cost' | 'full_cost';
export type TargetBasis = 'contribution' | 'managerial';

/** Linha de taxa já resolvida (do canal ou do perfil tributário informado). Percentuais em % (12,5 = 12,5 %); valores fixos em centavos. */
export type FeeLine = {
  id: string;
  name: string;
  kind: FeeKind;
  basis: FeeBasis;
  ratePct?: DecValue | null;
  fixedCents?: DecValue | null;
  minCents?: DecValue | null;
  maxCents?: DecValue | null;
};

export type Step = { key: string; label: string; formula: string; cents?: number; pct?: string | null; note?: string };

export type FeeResult = {
  id: string; name: string; kind: FeeKind; basis: FeeBasis;
  amountCents: number;
  /** Valor por unidade (texto decimal, centavos). */
  unitCents: string;
  capped: 'min' | 'max' | null;
};

export type EvalInput = {
  priceCents: number;
  quantity?: DecValue;
  /** Custo variável por unidade, em centavos (pode ter fração). Sempre conhecido: custo desconhecido não chega ao motor. */
  variableUnitCost: DecValue;
  overheadUnit?: DecValue | null;
  fees: FeeLine[];
  markupBase?: MarkupBase;
};

export type EvalResult = {
  priceCents: number;
  quantity: string;
  revenueCents: number;
  variableCostCents: number;
  fees: FeeResult[];
  totalFeesCents: number;
  contributionCents: number;
  /** Por unidade (texto decimal, centavos). */
  contributionUnitCents: string;
  /** Margem de contribuição em % (4 casas) ou null quando a receita não é positiva. */
  marginPct: string | null;
  markupBase: MarkupBase;
  markupBaseUnitCents: string;
  /** Markup em % (4 casas) ou null quando o custo-base é zero. */
  markupPct: string | null;
  overheadCents: number | null;
  managerialCents: number | null;
  managerialMarginPct: string | null;
  steps: Step[];
};

export type SolveInput = {
  variableUnitCost: DecValue;
  overheadUnit?: DecValue | null;
  fees: FeeLine[];
  quantity?: DecValue;
  /** Margem-alvo em % (0 = equilíbrio). */
  targetMarginPct: DecValue;
  targetBasis?: TargetBasis;
  rounding?: RoundingRule;
  floorCents?: number | null;
  markupBase?: MarkupBase;
};

export type SolveResult =
  | {
      status: 'ok';
      /** Preço exato antes do arredondamento (centavos, texto decimal). */
      exactPriceCents: string;
      priceCents: number;
      rounding: RoundingRule;
      evaluation: EvalResult;
      meetsTarget: boolean;
      achievedMarginPct: string | null;
      /** Pontos percentuais abaixo da meta por causa do arredondamento (null quando atinge). */
      shortfallPp: string | null;
      floorApplied: boolean;
      regime: string;
      multipleRoots: boolean;
      steps: Step[];
    }
  | { status: 'inviable'; reason: string; denominator: string }
  | { status: 'unresolvable'; reason: string };

export type CostClass = 'direct' | 'overhead';
export type AllocationMethod = 'volume' | 'services' | 'hours' | 'percent' | 'manual';
export type CostKind =
  | 'acquisition' | 'raw_material' | 'direct_labor' | 'packaging' | 'acquisition_freight' | 'supply' | 'outsourced_service' | 'other_direct' | 'allocated_overhead';

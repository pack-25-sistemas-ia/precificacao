// Composição de custos (docs/COST_MODEL.md): custo unitário, completude (desconhecido ≠ zero) e rateio de estrutura.
import { D, MAX_CENTS, PricingError, dec, type Dec, type DecValue } from './decimal';
import type { AllocationMethod, CostClass, CostKind } from './types';

export type CostComponentInput = {
  id: string;
  kind: CostKind;
  costClass: CostClass;
  name?: string;
  /** Centavos (pode ter fração). null/undefined = DESCONHECIDO. */
  amountCents: DecValue | null | undefined;
  /** Quantas unidades do item o valor cobre (lote). Padrão 1. */
  quantity?: DecValue | null;
  /** Quanto se consome por unidade (horas, kg…). Padrão 1. Em rateio `percent`, é o percentual. */
  usage?: DecValue | null;
  allocationMethod?: AllocationMethod | null;
  active?: boolean;
};

export type CostIssue = { code: 'no_cost' | 'unknown_cost' | 'unknown_overhead'; componentId?: string; message: string };

export type CostSummary = {
  status: 'complete' | 'incomplete';
  issues: CostIssue[];
  /** Custo direto unitário (centavos, texto decimal) ou null se incompleto. */
  directUnitCents: string | null;
  /** Rateio unitário: «none» (sem estrutura), «known» ou «unknown». */
  overheadStatus: 'none' | 'known' | 'unknown';
  overheadUnitCents: string | null;
  fullUnitCents: string | null;
  lines: Array<{ id: string; kind: CostKind; costClass: CostClass; unitCents: string | null; sharePct: string | null }>;
};

const present = (v: DecValue | null | undefined) => v !== null && v !== undefined && v !== '';

function checkRange(amount: Dec, quantity: Dec, usage: Dec, name: string) {
  if (amount.lt(0) || amount.gt(MAX_CENTS * 10)) throw new PricingError('invalid_cost', `${name}: valor fora do limite.`);
  if (quantity.lte(0)) throw new PricingError('invalid_cost', `${name}: a quantidade deve ser maior que zero.`);
  if (usage.lte(0)) throw new PricingError('invalid_cost', `${name}: o consumo por unidade deve ser maior que zero.`);
}

/** Custo unitário de um componente direto: valor ÷ quantidade × consumo. */
export function directUnitCost(amountCents: DecValue, quantity: DecValue = 1, usage: DecValue = 1): Dec {
  const a = dec(amountCents, 'Valor'); const q = dec(quantity, 'Quantidade'); const u = dec(usage, 'Consumo');
  checkRange(a, q, u, 'Componente');
  return a.div(q).mul(u);
}

export function summarizeCosts(components: readonly CostComponentInput[]): CostSummary {
  const active = components.filter((c) => c.active !== false);
  const issues: CostIssue[] = [];
  const direct = active.filter((c) => c.costClass === 'direct');
  const overhead = active.filter((c) => c.costClass === 'overhead');
  const unitOf = new Map<string, Dec | null>();

  let directSum = new D(0);
  let directKnown = true;
  if (!direct.length) { issues.push({ code: 'no_cost', message: 'O item não tem nenhum componente de custo direto.' }); directKnown = false; }
  for (const c of direct) {
    const name = c.name ?? c.id;
    if (!present(c.amountCents)) { issues.push({ code: 'unknown_cost', componentId: c.id, message: `Custo «${name}» sem valor informado (desconhecido, não zero).` }); unitOf.set(c.id, null); directKnown = false; continue; }
    const u = directUnitCost(c.amountCents!, c.quantity ?? 1, c.usage ?? 1);
    unitOf.set(c.id, u);
    directSum = directSum.plus(u);
  }

  let overheadSum = new D(0);
  let overheadKnown = true;
  for (const c of overhead) {
    const name = c.name ?? c.id;
    const method = c.allocationMethod ?? 'manual';
    let u: Dec | null = null;
    if (method === 'percent') {
      if (present(c.usage) && directKnown) { const p = dec(c.usage!, 'Percentual de rateio'); if (p.lt(0) || p.gt(1000)) throw new PricingError('invalid_cost', `${name}: percentual de rateio inválido.`); u = directSum.mul(p).div(100); }
    } else if (!present(c.amountCents)) u = null;
    else if (method === 'manual') { const a = dec(c.amountCents!, 'Valor'); if (a.lt(0)) throw new PricingError('invalid_cost', `${name}: valor negativo.`); u = a; }
    else {
      const a = dec(c.amountCents!, 'Valor');
      const vol = present(c.quantity) ? dec(c.quantity!, 'Volume') : null;
      if (a.lt(0)) throw new PricingError('invalid_cost', `${name}: valor negativo.`);
      if (vol && vol.gt(0)) {
        if (method === 'hours') { const h = present(c.usage) ? dec(c.usage!, 'Horas por unidade') : null; u = h && h.gt(0) ? a.div(vol).mul(h) : null; }
        else u = a.div(vol);
      }
    }
    unitOf.set(c.id, u);
    if (u === null) { overheadKnown = false; issues.push({ code: 'unknown_overhead', componentId: c.id, message: `Rateio «${name}» sem os parâmetros necessários (volume, horas ou percentual).` }); } else overheadSum = overheadSum.plus(u);
  }

  const complete = directKnown;
  const overheadStatus: CostSummary['overheadStatus'] = !overhead.length ? 'none' : overheadKnown ? 'known' : 'unknown';
  const full = complete && overheadStatus !== 'unknown' ? directSum.plus(overheadSum) : null;
  const lines = [...direct, ...overhead].map((c) => {
    const u = unitOf.get(c.id) ?? null;
    const share = u !== null && full && full.gt(0) ? u.div(full).mul(100).toDecimalPlaces(2).toFixed(2) : null;
    return { id: c.id, kind: c.kind, costClass: c.costClass, unitCents: u === null ? null : u.toDecimalPlaces(6).toFixed(), sharePct: share };
  });
  return {
    status: complete ? 'complete' : 'incomplete', issues,
    directUnitCents: complete ? directSum.toDecimalPlaces(6).toFixed() : null,
    overheadStatus, overheadUnitCents: overheadStatus === 'known' ? overheadSum.toDecimalPlaces(6).toFixed() : null,
    fullUnitCents: full ? full.toDecimalPlaces(6).toFixed() : null, lines,
  };
}

/** Variação entre duas versões de custo (texto decimal em centavos). null quando a base anterior é zero. */
export function costVariation(previousUnitCents: DecValue, currentUnitCents: DecValue): { deltaCents: string; deltaPct: string | null } {
  const prev = dec(previousUnitCents, 'Custo anterior'); const cur = dec(currentUnitCents, 'Custo atual');
  return { deltaCents: cur.minus(prev).toDecimalPlaces(6).toFixed(), deltaPct: prev.gt(0) ? cur.minus(prev).div(prev).mul(100).toDecimalPlaces(4).toFixed(4) : null };
}

// Aritmética decimal do motor de precificação (docs/PRICING_ENGINE.md §1). Nunca número binário em dinheiro:
// precisão 40, meio-para-cima, e arredondamento SÓ na fronteira de centavos.
import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Dec = InstanceType<typeof D>;
export type DecValue = string | number | Dec;

export const ENGINE_VERSION = '1.0.0';
/** Teto de centavos (mesmo do banco): R$ 999.999.999.999,99. */
export const MAX_CENTS = 99_999_999_999_999;

export type PricingErrorCode =
  | 'invalid_number' | 'invalid_price' | 'invalid_quantity' | 'invalid_cost' | 'invalid_fee' | 'invalid_margin' | 'invalid_discount' | 'invalid_policy' | 'limit_exceeded' | 'policy_conflict';

/** Erro de validação do motor: mensagem em português para a tela, `code` para testes e auditoria. */
export class PricingError extends Error {
  constructor(public readonly code: PricingErrorCode, message: string) { super(message); this.name = 'PricingError'; }
}

/** Converte entrada para Decimal ou falha com erro claro (nunca NaN/Infinity silenciosos). */
export function dec(value: DecValue, what: string): Dec {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new PricingError('invalid_number', `${what}: número inválido.`);
  try {
    const d = new D(value);
    if (!d.isFinite()) throw new Error('não finito');
    return d;
  } catch {
    throw new PricingError('invalid_number', `${what}: número inválido.`);
  }
}

/** Centavos inteiros (meio-para-cima) dentro do teto. */
export function roundCents(value: Dec, what = 'valor'): number {
  const n = value.toDecimalPlaces(0, D.ROUND_HALF_UP);
  if (n.abs().gt(MAX_CENTS)) throw new PricingError('limit_exceeded', `${what}: acima do limite permitido.`);
  return n.toNumber();
}

/** Centavos inteiros do preço informado: inteiro seguro, positivo, dentro do teto. */
export function priceCentsOf(value: number): number {
  if (!Number.isSafeInteger(value)) throw new PricingError('invalid_price', 'Preço precisa ser um inteiro de centavos.');
  if (value <= 0) throw new PricingError('invalid_price', 'Preço precisa ser maior que zero.');
  if (value > MAX_CENTS) throw new PricingError('limit_exceeded', 'Preço acima do limite permitido.');
  return value;
}

/** Percentual → texto com 4 casas («24.9970»); null quando não há base. */
export function pctText(ratio: Dec | null): string | null {
  return ratio === null ? null : ratio.mul(100).toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
}

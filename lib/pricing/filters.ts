// Filtros vindos da URL (a URL é a fonte: compartilhável e funciona sem JavaScript). Tudo validado; valor inválido cai no padrão.
import { addDays, isIsoDate, monthRange, todayIn } from './dates';

export const PERIODS = ['30d', '90d', '180d', 'year', 'month', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', '180d': 'Últimos 180 dias', year: 'Ano atual', month: 'Mês atual', custom: 'Período personalizado' };

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);

export type Filters = {
  period: Period; from: string; to: string; category: string | null; channel: string | null; type: 'product' | 'service' | null; risk: string | null; policy: string | null; scenario: string | null; user: string | null; item: string | null;
};

const RISKS = ['within_target', 'below_target', 'negative_contribution', 'below_break_even', 'incomplete_cost', 'invalid_rule', 'needs_review', 'no_price'];

export function resolveFilters(sp: SearchParams, timeZone: string, now: number = Date.now()): Filters {
  const today = todayIn(timeZone, now);
  const raw = one(sp.period);
  const period: Period = (PERIODS as readonly string[]).includes(raw ?? '') ? (raw as Period) : '90d';
  let from = today; let to = today;
  switch (period) {
    case '30d': from = addDays(today, -29); break;
    case '90d': from = addDays(today, -89); break;
    case '180d': from = addDays(today, -179); break;
    case 'month': ({ from, to } = monthRange(today)); break;
    case 'year': from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31`; break;
    case 'custom': {
      const f = one(sp.from); const t = one(sp.to);
      if (f && t && isIsoDate(f) && isIsoDate(t) && f <= t && (Date.parse(t) - Date.parse(f)) / 86_400_000 <= 731) { from = f; to = t; } else from = addDays(today, -89);
      break;
    }
    default: break;
  }
  const type = one(sp.type);
  const risk = one(sp.risk);
  return {
    period, from, to, category: uuidOrNull(one(sp.category)), channel: uuidOrNull(one(sp.channel)), type: type === 'product' || type === 'service' ? type : null,
    risk: risk && RISKS.includes(risk) ? risk : null, policy: uuidOrNull(one(sp.policy)), scenario: uuidOrNull(one(sp.scenario)), user: uuidOrNull(one(sp.user)), item: uuidOrNull(one(sp.item)),
  };
}

/** Texto de busca seguro para `ilike`: remove curingas e separadores do PostgREST. */
export function safeSearch(v: string | undefined): string | null {
  const s = (v ?? '').replace(/[%_,()*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}

export const PAGE_SIZE = 20;
export function pageFrom(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** Monta uma URL preservando os filtros atuais e alterando alguns. */
export function withParams(base: string, current: SearchParams, changes: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = one(v);
    if (s !== undefined && s !== '' && !(k in changes)) q.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null && v !== '') q.set(k, v);
  const str = q.toString();
  return str ? `${base}?${str}` : base;
}

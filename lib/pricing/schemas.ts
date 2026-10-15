// Validação de entrada no SERVIDOR (Zod). Dinheiro e percentuais entram como TEXTO brasileiro e viram valores exatos aqui; o banco valida de novo.
import { z } from 'zod';
import { isIsoDate } from './dates';
import { ALLOC_METHODS, CHANNEL_TYPES, DIRECT_COST_TYPES, FEE_BASES, FEE_KINDS, ROUNDING_RULES } from './labels';
import { MAX_CENTS, parseBRL } from './money';
import { parseQty, parseUnitCostCents } from './qty';

export const uuid = z.uuid('Registro inválido.');
export const optionalUuid = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.uuid('Seleção inválida.').nullable());
const text = (min: number, max: number, label = 'Campo') => z.string().trim().min(min, `${label}: mínimo de ${min} caracteres.`).max(max, `${label}: máximo de ${max} caracteres.`);
export const optionalText = (max: number) => z.preprocess((v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v), z.string().trim().max(max, `Máximo de ${max} caracteres.`).nullable());
export const flag = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
export const optionalDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().refine(isIsoDate, 'Data inválida.').nullable());
export const idemKey = z.preprocess((v) => (typeof v === 'string' && v.length >= 8 ? v : crypto.randomUUID()), z.string().min(8).max(100));
const blank = (v: unknown) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v);

/** Percentual brasileiro («12,5», «12.5», «12,5 %») → texto decimal («12.5»), 0 ≤ p ≤ max, até 4 casas. */
export function parsePct(input: string, max = 100): string | null {
  const s = input.replace(/%/g, '').trim();
  const q = parseQty(s, 4, { allowZero: true });
  if (q === null) return null;
  return Number(q) <= max ? q : null;
}
export const pct = (label: string, max = 100) => z.string().trim().transform((s, ctx) => {
  const v = parsePct(s, max);
  if (v === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe um percentual entre 0 e ${max} (ex.: 12,5).` }); return z.NEVER; }
  return v;
});
export const optionalPct = (label: string, max = 100) => z.preprocess(blank, z.string().nullable()).transform((s, ctx) => {
  if (s === null) return null;
  const v = parsePct(s, max);
  if (v === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe um percentual entre 0 e ${max} (ex.: 12,5).` }); return z.NEVER; }
  return v;
});
/** Dinheiro em reais → centavos inteiros (preço, taxas fixas). */
export const money = (label: string, opts: { positive?: boolean } = {}) => z.string().trim().transform((s, ctx) => {
  const c = parseBRL(s);
  if (c === null || c > MAX_CENTS || (opts.positive && c <= 0)) { ctx.addIssue({ code: 'custom', message: `${label}: use o formato 1.234,56${opts.positive ? ' (maior que zero)' : ''}.` }); return z.NEVER; }
  return c as number;
});
export const optionalMoney = (label: string) => z.preprocess(blank, z.string().nullable()).transform((s, ctx) => {
  if (s === null) return null;
  const c = parseBRL(s);
  if (c === null || c > MAX_CENTS) { ctx.addIssue({ code: 'custom', message: `${label}: use o formato 1.234,56.` }); return z.NEVER; }
  return c as number;
});
/** Custo em reais com até 4 casas → centavos (texto, pode ter fração). Vazio = DESCONHECIDO (null), nunca zero. */
const unknownCost = (label: string) => z.preprocess(blank, z.string().nullable()).transform((s, ctx) => {
  if (s === null) return null;
  const c = parseUnitCostCents(s);
  if (c === null) { ctx.addIssue({ code: 'custom', message: `${label}: use reais com até 4 casas (ex.: 12,34). Deixe em branco se ainda não souber.` }); return z.NEVER; }
  return c;
});
const positiveNumber = (label: string, decimals = 6, def = '1') => z.preprocess((v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? def : v), z.string()).transform((s, ctx) => {
  const q = parseQty(s, decimals);
  if (q === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe um número maior que zero (até ${decimals} casas).` }); return z.NEVER; }
  return q;
});

const SKU = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

// ---- cadastros
export const categorySchema = z.object({ name: text(1, 80, 'Nome'), parent_id: optionalUuid, description: optionalText(300) });
export const categoryEditSchema = categorySchema.extend({ id: uuid, active: flag });
export const itemSchema = z.object({
  sku: z.string().trim().regex(SKU, 'SKU: até 40 caracteres (letras, números, ponto, hífen, barra ou sublinhado).'),
  name: text(1, 160, 'Nome'), item_type: z.enum(['product', 'service'], 'Escolha produto ou serviço.'), category_id: optionalUuid, unit: text(1, 12, 'Unidade'), description: optionalText(1000),
});
export const itemEditSchema = itemSchema.omit({ item_type: true }).extend({ id: uuid, status: z.enum(['active', 'inactive']) });
export const archiveSchema = z.object({ id: uuid, archive: z.enum(['1', '0']) });
export const channelSchema = z.object({ name: text(1, 80, 'Nome'), channel_type: z.enum(CHANNEL_TYPES, 'Tipo de canal inválido.'), description: optionalText(300), tax_profile_id: optionalUuid });
export const channelEditSchema = channelSchema.extend({ id: uuid, active: flag });

export const feeRuleSchema = z.object({
  channel_id: uuid, name: text(1, 80, 'Nome'), fee_type: z.enum(FEE_KINDS, 'Tipo de taxa inválido.'), basis: z.enum(FEE_BASES, 'Base de incidência inválida.'),
  rate: optionalPct('Percentual'), fixed: optionalMoney('Valor fixo'), min: optionalMoney('Mínimo'), max: optionalMoney('Máximo'),
  priority: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : 100), z.number().int('Prioridade: número inteiro.').min(0).max(1000)),
  valid_from: optionalDate, valid_until: optionalDate,
}).superRefine((v, ctx) => {
  const rateBasis = v.basis === 'price' || v.basis === 'net_price' || v.basis === 'cost';
  if (rateBasis && v.rate === null) ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Informe o percentual desta base.' });
  if (!rateBasis && v.fixed === null) ctx.addIssue({ code: 'custom', path: ['fixed'], message: 'Informe o valor fixo desta base.' });
  if (!rateBasis && (v.min !== null || v.max !== null)) ctx.addIssue({ code: 'custom', path: ['min'], message: 'Mínimo e máximo valem só para taxas percentuais.' });
  if (v.min !== null && v.max !== null && v.min > v.max) ctx.addIssue({ code: 'custom', path: ['min'], message: 'O mínimo não pode superar o máximo.' });
  if (v.valid_from && v.valid_until && v.valid_until < v.valid_from) ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'A vigência termina antes de começar.' });
});
export const feeRuleEditSchema = z.object({ id: uuid, active: flag, name: text(1, 80, 'Nome') });

export const TAX_SLOTS = 6;
export const taxProfileSchema = z.object({ name: text(1, 80, 'Nome'), description: optionalText(500) });
export const taxLineSchema = z.object({
  name: text(1, 80, 'Nome do tributo'), rate: pct('Alíquota'), basis: z.enum(['price', 'net_price'], 'Base inválida.'), source: text(3, 200, 'Origem do parâmetro'),
});

// ---- custos
export const componentSchema = z.object({
  item_id: uuid, cost_class: z.enum(['direct', 'overhead'], 'Classe inválida.'), cost_type: z.enum([...DIRECT_COST_TYPES, 'allocated_overhead'], 'Tipo de custo inválido.'), name: text(1, 120, 'Nome'),
  amount: unknownCost('Valor'), quantity: positiveNumber('Quantidade'), usage: positiveNumber('Consumo'), unit: optionalText(12), allocation_method: z.preprocess(blank, z.enum(ALLOC_METHODS).nullable()),
}).superRefine((v, ctx) => {
  if (v.cost_class === 'direct' && v.cost_type === 'allocated_overhead') ctx.addIssue({ code: 'custom', path: ['cost_type'], message: 'Custo direto não pode ser rateio de estrutura.' });
  if (v.cost_class === 'overhead' && !v.allocation_method) ctx.addIssue({ code: 'custom', path: ['allocation_method'], message: 'Escolha o método de rateio.' });
  if (v.cost_class === 'overhead' && v.allocation_method === 'percent' && v.amount !== null) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'No rateio por percentual deixe o valor em branco e informe o percentual em «Consumo».' });
});
export const componentEditSchema = z.object({ id: uuid, name: text(1, 120, 'Nome'), amount: unknownCost('Valor'), quantity: positiveNumber('Quantidade'), usage: positiveNumber('Consumo'), active: flag });
export const idSchema = z.object({ id: uuid });
export const saveVersionSchema = z.object({ item_id: uuid, note: optionalText(300) });

// ---- políticas
export const policySchema = z.object({
  name: text(1, 80, 'Nome'), description: optionalText(500), target: pct('Margem-alvo', 99.9999), minimum: pct('Margem mínima', 99.9999), max_discount: optionalPct('Desconto máximo', 99.9999),
  rounding: z.enum(ROUNDING_RULES, 'Regra de arredondamento inválida.'), min_price: optionalMoney('Preço mínimo autorizado'),
}).superRefine((v, ctx) => { if (Number(v.minimum) > Number(v.target)) ctx.addIssue({ code: 'custom', path: ['minimum'], message: 'A margem mínima não pode superar a margem-alvo.' }); });
export const policyEditSchema = policySchema.extend({ id: uuid });
export const assignmentSchema = z.object({ policy_id: uuid, item_id: optionalUuid, category_id: optionalUuid, channel_id: optionalUuid, valid_from: optionalDate, valid_until: optionalDate }).superRefine((v, ctx) => {
  if (v.item_id && v.category_id) ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Escolha item OU categoria, não os dois.' });
  if (v.valid_from && v.valid_until && v.valid_until < v.valid_from) ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'A vigência termina antes de começar.' });
});

// ---- preços
export const priceChangeSchema = z.object({ item_id: uuid, channel_id: optionalUuid, price: money('Preço proposto', { positive: true }), justification: text(5, 500, 'Justificativa') });
export const reviewSchema = z.object({ id: uuid, decision: z.enum(['approve', 'reject'], 'Decisão inválida.'), note: optionalText(500) });
export const listSchema = z.object({ name: text(1, 80, 'Nome'), description: optionalText(500), channel_id: optionalUuid });
export const listVersionSchema = z.object({ list_id: uuid, valid_from: optionalDate, valid_until: optionalDate, note: optionalText(500), copy_from: optionalUuid });
export const listItemsSchema = z.object({ version_id: uuid, lines: z.string().max(100_000, 'Texto grande demais.') });

export const scenarioItemSchema = z.object({
  item_id: uuid, channel_id: uuid,
  price_cents: z.number().int().positive().max(MAX_CENTS).nullable().optional(),
  quantity: z.number().positive().max(1_000_000).default(1),
  cost_adjust_pct: z.number().min(-100).max(1000).default(0),
  extra_cost_cents: z.number().min(0).max(MAX_CENTS).default(0),
  discount_pct: z.number().min(0).lt(100).default(0),
  target_margin_pct: z.number().min(0).lt(100).nullable().optional(),
  suggested_price_cents: z.number().int().positive().max(MAX_CENTS).nullable().optional(),
});
export const scenarioSchema = z.object({
  scenario_id: optionalUuid, name: text(1, 80, 'Nome'), description: optionalText(500),
  payload: z.string().max(200_000).transform((s, ctx) => {
    try { return z.array(scenarioItemSchema).min(1, 'O cenário precisa de ao menos um item.').max(200, 'No máximo 200 itens por cenário.').parse(JSON.parse(s)); }
    catch (e) { ctx.addIssue({ code: 'custom', message: e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Itens do cenário inválidos.') : 'Itens do cenário inválidos.' }); return z.NEVER; }
  }),
});

// ---- configurações
export const settingsSchema = z.object({
  default_target_margin_pct: pct('Margem-alvo padrão', 99.9999), default_minimum_margin_pct: pct('Margem mínima padrão', 99.9999), default_rounding: z.enum(ROUNDING_RULES),
  price_review_days: z.coerce.number().int('Dias: número inteiro.').min(7, 'Mínimo de 7 dias.').max(730, 'Máximo de 730 dias.'),
  near_minimum_margin_pp: pct('Faixa próxima da mínima', 20), segregation_of_duties: flag,
}).superRefine((v, ctx) => { if (Number(v.default_minimum_margin_pct) > Number(v.default_target_margin_pct)) ctx.addIssue({ code: 'custom', path: ['default_minimum_margin_pct'], message: 'A margem mínima não pode superar a margem-alvo.' }); });

// ---- importação
export const IMPORT_TYPES = ['categories', 'items', 'costs', 'prices', 'fees', 'sales'] as const;
export const importSchema = z.object({
  type: z.enum(IMPORT_TYPES, 'Tipo de importação inválido.'), file_name: z.string().trim().min(1).max(200), hash: z.string().regex(/^[0-9a-f]{64}$/, 'Arquivo inválido.'),
  rows: z.string().max(5_000_000).transform((s, ctx) => {
    try { const v = JSON.parse(s) as unknown; if (!Array.isArray(v) || v.length < 1 || v.length > 5000) throw new Error('linhas'); return v as Array<Record<string, string>>; }
    catch { ctx.addIssue({ code: 'custom', message: 'O arquivo precisa ter de 1 a 5.000 linhas.' }); return z.NEVER; }
  }),
});

// CSV: leitura (RFC 4180 + padrões brasileiros) e escrita segura. Módulo puro — roda no navegador (prévia do mapeamento) e no servidor (valor final).
import { isIsoDate, parseDateBR } from './dates';
import { parseBRL } from './money';
import { parseQty, parseUnitCostCents } from './qty';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_FIELD = 2000;

/** Decodifica bytes: UTF-8 estrito; se falhar (arquivos do Excel/bancos), Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 5).filter((l) => l.trim() !== '');
  let best = ',';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = sample.map((line) => { let n = 0; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = counts[0]! * (consistent ? 1000 : 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export class CsvError extends Error {}

/** Lê o CSV em matriz de células. Aspas duplas, aspas escapadas («""»), quebras de linha dentro de campo, CRLF/LF/CR. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    if (field.length > MAX_FIELD) throw new CsvError('Há uma célula com mais de 2.000 caracteres.');
    row.push(field); field = '';
    if (row.length > MAX_COLS) throw new CsvError('O arquivo tem colunas demais (máximo de 60).');
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new CsvError(`O arquivo tem mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === '\r') { pushRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvError('Aspas não fechadas: o arquivo parece truncado ou malformado.');
  if (field !== '' || row.length) pushRow();
  return rows;
}

export const normalizeHeader = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();


// ---------------------------------------------------------------------------- campos por tipo de importação
export type ImportType = 'categories' | 'items' | 'costs' | 'prices' | 'fees' | 'sales';
export const IMPORT_LABELS: Record<ImportType, string> = {
  categories: 'Categorias', items: 'Produtos e serviços', costs: 'Custos (componentes)', prices: 'Preços (viram propostas para aprovação)', fees: 'Taxas e comissões de canal', sales: 'Vendas observadas',
};
export const IMPORT_HINTS: Record<ImportType, string> = {
  categories: 'A categoria-pai precisa existir (importe-a antes).',
  items: 'Produtos e serviços. A categoria precisa existir.',
  costs: 'Valor em branco = custo DESCONHECIDO (não zero). Importar custo grava o rascunho; salve a versão na tela do item.',
  prices: 'NÃO publica nada: cada linha vira uma proposta pendente de aprovação. O item precisa ter versão de custo.',
  fees: 'Só gestor/administrador. Tributos são parâmetros informados (perfil tributário), não entram aqui.',
  sales: 'Só gestor/administrador. Dados reais; a margem ponderada usa a versão de custo vigente na data.',
};

export type FieldSpec = { key: string; label: string; required: boolean; aliases: string[]; hint?: string };
export const FIELDS: Record<ImportType, FieldSpec[]> = {
  categories: [
    { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'categoria', 'name'] },
    { key: 'parent', label: 'Categoria-pai', required: false, aliases: ['pai', 'categoria pai', 'parent'] },
  ],
  items: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia', 'ref'], hint: 'Único por empresa (não diferencia maiúsculas).' },
    { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'produto', 'servico', 'descricao', 'name'] },
    { key: 'type', label: 'Tipo (produto ou serviço)', required: true, aliases: ['tipo', 'type'] },
    { key: 'unit', label: 'Unidade', required: true, aliases: ['unidade', 'un', 'unid', 'unit'] },
    { key: 'category', label: 'Categoria', required: false, aliases: ['categoria', 'category', 'grupo'] },
    { key: 'description', label: 'Descrição', required: false, aliases: ['detalhes', 'observacao', 'description'] },
  ],
  costs: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia'] },
    { key: 'name', label: 'Nome do componente', required: true, aliases: ['componente', 'nome', 'descricao', 'name'] },
    { key: 'cost_type', label: 'Tipo de custo', required: false, aliases: ['tipo', 'tipo de custo', 'type'], hint: 'Aquisição, matéria-prima, mão de obra, embalagem, frete, insumo, terceirizado, outro.' },
    { key: 'amount', label: 'Valor (R$)', required: false, aliases: ['valor', 'custo', 'amount', 'preco de custo'], hint: 'Em branco = desconhecido.' },
    { key: 'quantity', label: 'Quantidade do lote', required: false, aliases: ['quantidade', 'qtd', 'lote', 'quantity'] },
    { key: 'usage', label: 'Consumo por unidade', required: false, aliases: ['consumo', 'uso', 'usage'] },
    { key: 'cost_class', label: 'Classe (direto ou rateio)', required: false, aliases: ['classe', 'class'] },
    { key: 'allocation_method', label: 'Método de rateio', required: false, aliases: ['rateio', 'metodo', 'metodo de rateio'] },
  ],
  prices: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia'] },
    { key: 'channel', label: 'Canal (vazio = preço-base)', required: false, aliases: ['canal', 'channel'] },
    { key: 'price', label: 'Preço (R$)', required: true, aliases: ['preco', 'preco de venda', 'valor', 'price'] },
  ],
  fees: [
    { key: 'channel', label: 'Canal', required: true, aliases: ['canal', 'channel'] },
    { key: 'name', label: 'Nome da taxa', required: true, aliases: ['taxa', 'nome', 'name'] },
    { key: 'kind', label: 'Tipo', required: true, aliases: ['tipo', 'kind'], hint: 'Comissão, pagamento, plataforma, frete subsidiado, transação, outra.' },
    { key: 'basis', label: 'Base', required: true, aliases: ['base', 'incidencia', 'basis'], hint: 'Preço, preço líquido, custo, fixo por unidade, fixo por transação.' },
    { key: 'rate', label: 'Percentual (%)', required: false, aliases: ['percentual', 'taxa %', 'aliquota', 'rate'] },
    { key: 'fixed', label: 'Valor fixo (R$)', required: false, aliases: ['fixo', 'valor fixo', 'fixed'] },
    { key: 'min', label: 'Mínimo (R$)', required: false, aliases: ['minimo', 'min'] },
    { key: 'max', label: 'Máximo / teto (R$)', required: false, aliases: ['maximo', 'teto', 'max'] },
  ],
  sales: [
    { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'cod', 'referencia'] },
    { key: 'channel', label: 'Canal', required: false, aliases: ['canal', 'channel'] },
    { key: 'date', label: 'Data', required: true, aliases: ['data', 'date', 'dia'] },
    { key: 'quantity', label: 'Quantidade', required: true, aliases: ['quantidade', 'qtd', 'quantity'] },
    { key: 'gross', label: 'Receita bruta (R$)', required: true, aliases: ['receita', 'bruto', 'valor', 'total', 'gross'] },
    { key: 'discount', label: 'Desconto (R$)', required: false, aliases: ['desconto', 'discount'] },
    { key: 'fees', label: 'Taxas (R$)', required: false, aliases: ['taxas', 'comissao', 'fees'] },
    { key: 'reference', label: 'Referência externa', required: false, aliases: ['referencia externa', 'pedido', 'ref', 'reference'], hint: 'Evita importar o mesmo pedido duas vezes.' },
  ],
};

/** Sugere o mapeamento campo → índice de coluna pelos nomes do cabeçalho (nunca repete coluna). */
export function suggestMapping(kind: ImportType, headers: string[]): Record<string, number | null> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of FIELDS[kind]) {
    let found: number | null = null;
    for (const alias of f.aliases) { const idx = norm.findIndex((h, i) => !used.has(i) && h === alias); if (idx >= 0) { found = idx; break; } }
    if (found === null) for (const alias of f.aliases) { const idx = norm.findIndex((h, i) => !used.has(i) && h.includes(alias)); if (idx >= 0) { found = idx; break; } }
    if (found !== null) used.add(found);
    out[f.key] = found;
  }
  return out;
}

// ---------------------------------------------------------------------------- linhas normalizadas (o banco valida de novo)
export type NormalizedRow = { row_number: number; data: Record<string, string>; parse_error: string | null };

const cell = (row: string[], idx: number | null | undefined) => (idx === null || idx === undefined ? '' : (row[idx] ?? '').trim());
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const key = normalizeHeader;
const MAPS = {
  type: { produto: 'product', product: 'product', mercadoria: 'product', servico: 'service', service: 'service' } as Record<string, string>,
  costType: {
    aquisicao: 'acquisition', compra: 'acquisition', acquisition: 'acquisition', 'materia prima': 'raw_material', raw_material: 'raw_material', 'mao de obra': 'direct_labor', 'mao de obra direta': 'direct_labor', direct_labor: 'direct_labor',
    embalagem: 'packaging', packaging: 'packaging', frete: 'acquisition_freight', 'frete de aquisicao': 'acquisition_freight', acquisition_freight: 'acquisition_freight', insumo: 'supply', supply: 'supply',
    terceirizado: 'outsourced_service', 'servico terceirizado': 'outsourced_service', outsourced_service: 'outsourced_service', outro: 'other_direct', other_direct: 'other_direct',
  } as Record<string, string>,
  costClass: { direto: 'direct', direct: 'direct', rateio: 'overhead', estrutura: 'overhead', overhead: 'overhead' } as Record<string, string>,
  alloc: {
    volume: 'volume', 'por volume': 'volume', servicos: 'services', services: 'services', horas: 'hours', hours: 'hours', percentual: 'percent', percent: 'percent', manual: 'manual',
  } as Record<string, string>,
  feeKind: {
    comissao: 'commission', commission: 'commission', pagamento: 'payment', payment: 'payment', plataforma: 'platform', platform: 'platform', 'frete subsidiado': 'shipping_subsidy', shipping_subsidy: 'shipping_subsidy',
    transacao: 'transaction', transaction: 'transaction', outra: 'other', outro: 'other', other: 'other',
  } as Record<string, string>,
  basis: {
    preco: 'price', price: 'price', 'sobre o preco': 'price', 'preco liquido': 'net_price', net_price: 'net_price', custo: 'cost', cost: 'cost', 'fixo por unidade': 'fixed_unit', fixed_unit: 'fixed_unit', 'fixo por transacao': 'fixed_transaction', fixed_transaction: 'fixed_transaction',
  } as Record<string, string>,
};

/** Leitura síncrona das linhas (sem hash): serve à prévia no navegador e é a base do envio ao banco. Erro de leitura vira `parse_error` por linha. */
export function normalizeRows(kind: ImportType, rows: string[][], mapping: Record<string, number | null>, firstRowNumber = 2): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]!;
    const g = (k: string) => clean(cell(row, mapping[k]));
    const data: Record<string, string> = {};
    let err: string | null = null;
    const setText = (k: string, max: number) => { const v = g(k); if (v) data[k] = v.slice(0, max); };
    const setMap = (k: string, map: Record<string, string>, label: string, def?: string) => {
      const v = g(k);
      if (!v) { if (def) data[k] = def; return; }
      const code = map[key(v)] ?? map[v.toLowerCase()];
      if (code) data[k] = code; else err ??= `${label} «${v.slice(0, 24)}» desconhecido`;
    };
    /** Dinheiro em reais → centavos inteiros (texto). Vazio mantém vazio. */
    const setMoney = (k: string, label: string) => {
      const v = g(k);
      if (!v) return;
      const c = parseBRL(v);
      if (c === null) err ??= `${label} «${v.slice(0, 20)}» não é um valor válido (use 12,34)`; else data[k] = String(c);
    };
    const setNum = (k: string, label: string, decimals = 6) => {
      const v = g(k);
      if (!v) return;
      const q = parseQty(v, decimals, { allowZero: true });
      if (q === null) err ??= `${label} «${v.slice(0, 20)}» não é um número válido`; else data[k] = q;
    };
    const setPct = (k: string, label: string) => {
      const v = g(k).replace(/%/g, '').trim();
      if (!v) return;
      const q = parseQty(v, 4, { allowZero: true });
      if (q === null || Number(q) > 100) err ??= `${label} «${v.slice(0, 12)}» deve estar entre 0 e 100`; else data[k] = q;
    };

    if (kind === 'categories') {
      setText('name', 80); setText('parent', 80);
    } else if (kind === 'items') {
      setText('sku', 40); setText('name', 160); setText('unit', 12); setText('category', 80); setText('description', 1000); setMap('type', MAPS.type, 'tipo');
    } else if (kind === 'costs') {
      setText('sku', 40); setText('name', 120); setMap('cost_class', MAPS.costClass, 'classe', 'direct'); setMap('cost_type', MAPS.costType, 'tipo de custo');
      setMap('allocation_method', MAPS.alloc, 'método de rateio');
      const a = g('amount');
      if (a) { const c = parseUnitCostCents(a); if (c === null) err ??= `valor «${a.slice(0, 20)}» não é válido (use 12,34 com até 4 casas)`; else data.amount = c; }
      setNum('quantity', 'quantidade'); setNum('usage', 'consumo');
      if (data.cost_class === 'direct' && !data.cost_type) err ??= 'informe o tipo de custo';
    } else if (kind === 'prices') {
      setText('sku', 40); setText('channel', 80); setMoney('price', 'preço');
    } else if (kind === 'fees') {
      setText('channel', 80); setText('name', 80); setMap('kind', MAPS.feeKind, 'tipo'); setMap('basis', MAPS.basis, 'base');
      setPct('rate', 'percentual'); setMoney('fixed', 'valor fixo'); setMoney('min', 'mínimo'); setMoney('max', 'máximo');
    } else {
      setText('sku', 40); setText('channel', 80); setText('reference', 80);
      const d = g('date');
      if (d) { const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : parseDateBR(d); if (iso && isIsoDate(iso)) data.date = iso; else err ??= `data «${d.slice(0, 12)}» inválida (use DD/MM/AAAA)`; }
      setNum('quantity', 'quantidade'); setMoney('gross', 'receita'); setMoney('discount', 'desconto'); setMoney('fees', 'taxas');
    }
    if (err) data._parse_error = err;
    out.push({ row_number: firstRowNumber + n, data, parse_error: err });
  }
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------- escrita segura
export type NumCell = { num: string };
export type CsvValue = string | number | null | undefined | NumCell;

/** Neutraliza injeção de fórmula (=, +, -, @, TAB, CR no início de TEXTO). Números formais passam como {num}. */
export function safeCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const raw = typeof v === 'string' ? v : v.num;
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV com ponto-e-vírgula e BOM (abre direto no Excel brasileiro). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(safeCell).join(';'), ...rows.map((r) => r.map(safeCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

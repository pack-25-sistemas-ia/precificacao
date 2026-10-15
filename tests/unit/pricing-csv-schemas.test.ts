import { describe, expect, it } from 'vitest';
import { CsvError, decodeText, detectDelimiter, normalizeRows, parseCsv, safeCell, suggestMapping, toCsv } from '@/lib/pricing/csv';
import { parseQty, parseUnitCostCents } from '@/lib/pricing/qty';

describe('leitura de CSV', () => {
  it('detecta ; e vírgula e lê aspas, aspas escapadas e quebra de linha em campo', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(parseCsv('a;b\r\n"x;y";"diz ""oi"""\r\n"l1\nl2";z\r\n', ';')).toEqual([['a', 'b'], ['x;y', 'diz "oi"'], ['l1\nl2', 'z']]);
  });
  it('recusa aspas não fechadas e célula gigante', () => {
    expect(() => parseCsv('a;"b', ';')).toThrow(CsvError);
    expect(() => parseCsv(`a;${'x'.repeat(2001)}`, ';')).toThrow(CsvError);
  });
  it('decodifica UTF-8 (sem BOM) e cai para Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ text: 'a', encoding: 'utf-8' });
    const r = decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(r.encoding).toBe('windows-1252');
    expect(r.text).toBe('café');
  });
  it('mapeia cabeçalhos com acento e normaliza linhas de custos (vazio = desconhecido, não zero)', () => {
    const headers = ['SKU', 'Descrição do custo', 'Valor'];
    const mapping = suggestMapping('costs', headers);
    expect(typeof mapping).toBe('object');
    const rows = normalizeRows('costs', [['A1', 'Compra', '']], mapping);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.row_number).toBe(2);
    expect(Object.values(rows[0]!.data)).not.toContain('0');
  });
});

describe('escrita segura', () => {
  it('neutraliza fórmulas em texto, mas deixa números formais passarem', () => {
    for (const bad of ['=1+1', '+1', '-1', '@x', '\tx', '\rx']) expect(safeCell(bad).replace(/^"/, '')).toMatch(/^'/);
    expect(safeCell(-5)).toBe('-5');
    expect(safeCell({ num: '-12,50' })).toBe('"-12,50"'); // sem apóstrofo; aspas só por causa da vírgula
    expect(safeCell('a;b')).toBe('"a;b"');
    expect(safeCell(null)).toBe('');
  });
  it('gera BOM, ; e CRLF', () => {
    expect(toCsv(['a', 'b'], [['x', 1]])).toBe('﻿a;b\r\nx;1\r\n');
  });
});

describe('entrada numérica brasileira', () => {
  it('quantidade: milhar x decimal conforme a unidade', () => {
    expect(parseQty('1.234', 0)).toBe('1234');
    expect(parseQty('1.234', 3)).toBe('1.234');
    expect(parseQty('1.234,5', 3)).toBe('1234.5');
    expect(parseQty('0', 0)).toBeNull();
    expect(parseQty('0', 0, { allowZero: true })).toBe('0');
    expect(parseQty('1,5', 0)).toBeNull();
    expect(parseQty('abc', 0)).toBeNull();
    expect(parseQty('-1', 0)).toBeNull();
  });
  it('custo unitário em reais → centavos, até 4 casas de reais', () => {
    expect(parseUnitCostCents('12,34')).toBe('1234');
    expect(parseUnitCostCents('R$ 0,0125')).toBe('1.25');
    expect(parseUnitCostCents('1.234,56')).toBe('123456');
    expect(parseUnitCostCents('0,00001')).toBeNull();
    expect(parseUnitCostCents('1,2,3')).toBeNull();
    expect(parseUnitCostCents('')).toBeNull();
  });
});

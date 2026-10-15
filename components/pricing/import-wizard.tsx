'use client';

import { useId, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Alert, Field, Input, Select } from '@/components/ui/primitives';
import { cancelImport, commitImport, createImport } from '@/lib/pricing/actions/imports';
import { CsvError, decodeText, detectDelimiter, FIELDS, IMPORT_HINTS, IMPORT_LABELS, MAX_FILE_BYTES, normalizeRows, parseCsv, sha256Hex, suggestMapping, type ImportType } from '@/lib/pricing/csv';
import { usePrAction } from './use-pr-action';

const DELIMS: Array<{ v: string; label: string }> = [{ v: ';', label: 'Ponto e vírgula ( ; )' }, { v: ',', label: 'Vírgula ( , )' }, { v: 'tab', label: 'Tabulação' }, { v: '|', label: 'Barra vertical ( | )' }];
const TAB = String.fromCharCode(9);
const KINDS: ImportType[] = ['categories', 'items', 'costs', 'prices', 'fees', 'sales'];

/** Passo 1 → 2: escolher tipo/arquivo, conferir o mapeamento e a leitura de exemplo. O BANCO valida cada linha na prévia; só a confirmação grava. */
export function ImportWizard({ canManager }: { canManager: boolean }) {
  const p = useId();
  const [kind, setKind] = useState<ImportType>('items');
  const [delim, setDelim] = useState(';');
  const [fileInfo, setFileInfo] = useState<{ name: string; encoding: string; hash: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ text: string; encoding: string } | null>(null);
  const [state, action, ref] = usePrAction(createImport, { reset: false });
  const e = state.fieldErrors ?? {};

  const parsed = useMemo(() => {
    if (!raw) return { table: null as string[][] | null, error: null as string | null };
    try { return { table: parseCsv(raw.text, delim === 'tab' ? TAB : delim), error: null }; }
    catch (err) { return { table: null, error: err instanceof CsvError ? err.message : 'Não foi possível ler o arquivo.' }; }
  }, [raw, delim]);
  const table = parsed.table;
  const readError = fileError ?? parsed.error;
  const header = useMemo(() => table?.[0] ?? [], [table]);
  const mapping = useMemo(() => ({ ...suggestMapping(kind, header), ...overrides }), [kind, header, overrides]);
  const specs = FIELDS[kind];
  const missing = specs.filter((f) => f.required && mapping[f.key] == null);
  const dup = useMemo(() => { const vals = Object.values(mapping).filter((v): v is number => v !== null); return new Set(vals).size !== vals.length; }, [mapping]);
  const rows = useMemo(() => (table && table.length >= 2 ? normalizeRows(kind, table.slice(1), mapping) : []), [kind, table, mapping]);
  const sample = rows.slice(0, 8);
  const shown = specs.filter((f) => mapping[f.key] != null).slice(0, 6);
  const payload = useMemo(() => JSON.stringify(rows.map((r) => r.data)), [rows]);

  async function onFile(file: File | undefined) {
    setRaw(null); setFileInfo(null); setFileError(null); setOverrides({});
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setFileError('O arquivo passa de 5 MB. Divida-o em partes menores.'); return; }
    if (!/\.(csv|txt)$/i.test(file.name)) { setFileError('Envie um arquivo .csv (ou .txt). Planilhas XLSX não são aceitas: salve como CSV.'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const d = decodeText(bytes);
    const found = detectDelimiter(d.text);
    setDelim(found === TAB ? 'tab' : found);
    setRaw(d); setFileInfo({ name: file.name, encoding: d.encoding, hash: await sha256Hex(bytes) });
  }

  return (
    <form ref={ref} action={action} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="O que importar" name={`${p}kind`} errors={e.type} hint={IMPORT_HINTS[kind]}>
          <Select id={`${p}kind`} name="type" value={kind} onChange={(ev) => { setKind(ev.target.value as ImportType); setOverrides({}); }}>
            {KINDS.filter((k) => canManager || k === 'items' || k === 'costs' || k === 'prices').map((k) => <option key={k} value={k}>{IMPORT_LABELS[k]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Arquivo CSV (até 5 MB e 5.000 linhas)" name={`${p}file`}>
            <Input id={`${p}file`} type="file" accept=".csv,.txt,text/csv,text/plain" required onChange={(ev) => void onFile(ev.target.files?.[0])} />
          </Field>
        </div>
      </div>

      {kind === 'prices' ? <Alert tone="info">Os preços importados <strong>não são publicados</strong>: cada linha vira uma proposta pendente de aprovação.</Alert> : null}
      {readError ? <Alert tone="error">{readError}</Alert> : null}

      {table && table.length >= 2 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Separador" name={`${p}delimiter`} hint={fileInfo ? `Arquivo «${fileInfo.name}», codificação ${fileInfo.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252 (acentos convertidos)'}.` : undefined}>
              <Select id={`${p}delimiter`} value={delim} onChange={(ev) => setDelim(ev.target.value)}>{DELIMS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}</Select>
            </Field>
            <p className="self-end pb-2 text-sm text-muted">{table.length - 1} linha(s) de dados e {header.length} coluna(s) encontradas.</p>
          </div>

          <fieldset className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">Mapeamento das colunas</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {specs.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} name={`map-${f.key}`} hint={f.hint}>
                  <Select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(ev) => setOverrides((m) => ({ ...m, [f.key]: ev.target.value === '' ? null : Number(ev.target.value) }))}>
                    <option value="">— não usar —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {missing.length ? <p role="alert" className="mt-3 text-sm text-danger">Falta indicar: {missing.map((f) => f.label).join(', ')}.</p> : null}
            {dup ? <p role="alert" className="mt-3 text-sm text-danger">A mesma coluna foi usada em dois campos.</p> : null}
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium">Como as primeiras linhas serão lidas</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Leitura de exemplo das primeiras linhas</caption>
                <thead><tr className="text-left text-xs uppercase text-muted"><th scope="col" className="px-3 py-2">Linha</th>{shown.map((f) => <th scope="col" key={f.key} className="px-3 py-2">{f.label}</th>)}<th scope="col" className="px-3 py-2">Leitura</th></tr></thead>
                <tbody>
                  {sample.map((r) => (
                    <tr key={r.row_number} className="border-t border-border">
                      <td className="px-3 py-1.5 tabular-nums">{r.row_number}</td>
                      {shown.map((f) => <td key={f.key} className="max-w-48 truncate px-3 py-1.5">{r.data[f.key] ?? ''}</td>)}
                      <td className="px-3 py-1.5">{r.parse_error ? <span className="text-danger">{r.parse_error}</span> : <span className="text-success">Lida</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <input type="hidden" name="file_name" value={fileInfo?.name ?? ''} />
          <input type="hidden" name="hash" value={fileInfo?.hash ?? ''} />
          <input type="hidden" name="rows" value={payload} />
          <FormMessage state={state} />
          <SubmitButton pendingText="Validando no banco…">Gerar prévia da importação</SubmitButton>
          <p className="text-xs text-muted">Nada é gravado ainda: a prévia mostra erros e repetições para você confirmar na próxima tela.</p>
        </>
      ) : <FormMessage state={state} />}
    </form>
  );
}

export function CommitImportForm({ id, kind, validRows }: { id: string; kind: string; validRows: number }) {
  const [state, action] = usePrAction(commitImport, { reset: false });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="type" value={kind} />
      <SubmitButton pendingText="Importando…">{`Confirmar importação de ${validRows} linha(s)`}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CancelImportForm({ id, kind }: { id: string; kind: string }) {
  const [state, action] = usePrAction(cancelImport, { reset: false });
  return <form action={action} className="space-y-3"><input type="hidden" name="id" value={id} /><input type="hidden" name="type" value={kind} /><SubmitButton variant="secondary" pendingText="…">Cancelar prévia</SubmitButton><FormMessage state={state} /></form>;
}

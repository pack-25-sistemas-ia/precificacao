'use client';

import { cancelPriceChange, createList, createListVersion, discardListVersion, publishListVersion, publishPriceChange, requestPriceChange, retireListVersion, reviewListVersion, reviewPriceChange, setListItems, submitListVersion, withdrawListVersion } from '@/lib/pricing/actions/pricing';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Textarea } from '@/components/ui/primitives';
import { useId } from 'react';
import type { Opt } from './bits';
import { ActionButton, AreaF, PrForm, SelectF, TextF } from './fields';
import { usePrAction } from './use-pr-action';

export function RequestPriceForm({ itemId, channels, hasBasePrice }: { itemId: string; channels: Opt[]; hasBasePrice?: boolean }) {
  void hasBasePrice;
  return (
    <PrForm action={requestPriceChange} submit="Propor preço (vai para aprovação)" hidden={{ item_id: itemId }}>
      {(f) => (<>
        <SelectF f={f} name="channel_id" label="Canal" opts={channels} placeholder="Preço-base (sem canal)" />
        <TextF f={f} name="price" label="Preço proposto (R$)" inputMode="decimal" required placeholder="Ex.: 83,34" />
        <div className="sm:col-span-2"><TextF f={f} name="justification" label="Justificativa" required max={500} placeholder="Por que este preço? (mínimo de 5 caracteres)" /></div>
      </>)}
    </PrForm>
  );
}

/** Aprovar ou rejeitar: a rejeição exige motivo; a segregação (quem propôs não aprova) é imposta pelo banco. */
export function ReviewForm({ id, kind }: { id: string; kind: 'price' | 'list' }) {
  const p = useId();
  const action = kind === 'price' ? reviewPriceChange : reviewListVersion;
  const [state, formAction, ref] = usePrAction(action, { reset: true });
  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Field label="Observação (obrigatória para rejeitar)" name={`${p}n`} errors={state.fieldErrors?.note}><input id={`${p}n`} name="note" maxLength={500} className="min-h-10 w-64 rounded-md border border-border bg-card px-3 text-sm" /></Field>
      <button name="decision" value="approve" className="min-h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Aprovar</button>
      <button name="decision" value="reject" className="min-h-10 rounded-md border border-danger px-3 text-sm font-medium text-danger">Rejeitar</button>
      <FormMessage state={state} />
    </form>
  );
}

export const PublishRequestButton = ({ id }: { id: string }) => (
  <ActionButton action={publishPriceChange} fields={{ id }} label="Publicar preço" variant="primary" confirm="Publicar altera o preço vigente NESTE sistema (nada é enviado a lojas ou marketplaces). Confirmar?" />
);
export const CancelRequestButton = ({ id }: { id: string }) => <ActionButton action={cancelPriceChange} fields={{ id }} label="Cancelar" variant="danger" confirm="Cancelar a solicitação?" />;

export function ListForm({ channels }: { channels: Opt[] }) {
  return (
    <PrForm action={createList} submit="Criar lista de preços">
      {(f) => (<>
        <TextF f={f} name="name" label="Nome" required max={80} />
        <SelectF f={f} name="channel_id" label="Canal" opts={channels} placeholder="Todos os canais" hint="Define taxas e política usadas na validação." />
        <TextF f={f} name="description" label="Descrição (opcional)" max={500} span />
      </>)}
    </PrForm>
  );
}

export function ListVersionForm({ listId, versions }: { listId: string; versions: Opt[] }) {
  return (
    <PrForm action={createListVersion} submit="Criar revisão" hidden={{ list_id: listId }}>
      {(f) => (<>
        <TextF f={f} name="valid_from" label="Vigente desde" type="date" />
        <TextF f={f} name="valid_until" label="Vigente até (opcional)" type="date" />
        <SelectF f={f} name="copy_from" label="Copiar itens da versão" opts={versions} placeholder="— começar vazia —" />
        <TextF f={f} name="note" label="Observação (opcional)" max={500} />
      </>)}
    </PrForm>
  );
}

export function ListItemsForm({ versionId, initial }: { versionId: string; initial: string }) {
  const p = useId();
  const [state, formAction, ref] = usePrAction(setListItems, { reset: false });
  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <input type="hidden" name="version_id" value={versionId} />
      <Field label="Itens da lista (uma linha por item)" name={`${p}l`} errors={state.fieldErrors?.lines} hint="Formato: SKU;preço;quantidade mínima;quantidade máxima — ex.: P1;30,00 ou P1;28,00;10;50 (faixas). Linhas com # são ignoradas.">
        <Textarea id={`${p}l`} name="lines" rows={8} defaultValue={state.values?.lines ?? initial} className="font-mono" />
      </Field>
      <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Salvando…">Gravar itens do rascunho</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}

export function ListVersionButtons({ id, status, canManage, canAnalyst, mineSubmitted }: { id: string; status: string; canManage: boolean; canAnalyst: boolean; mineSubmitted: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === 'draft' && canAnalyst ? <ActionButton action={submitListVersion} fields={{ id }} label="Enviar para aprovação" variant="primary" /> : null}
      {status === 'draft' && canAnalyst ? <ActionButton action={discardListVersion} fields={{ id }} label="Descartar rascunho" variant="danger" confirm="Descartar o rascunho e seus itens?" /> : null}
      {(status === 'pending' || status === 'approved') && (canManage || mineSubmitted) ? <ActionButton action={withdrawListVersion} fields={{ id }} label="Retirar da fila" /> : null}
      {status === 'approved' && canManage ? <ActionButton action={publishListVersion} fields={{ id }} label="Publicar lista" variant="primary" confirm="Publicar disponibiliza esta versão NESTE sistema e aposenta a versão anterior que se sobrepõe. Confirmar?" /> : null}
      {status === 'published' && canManage ? <ActionButton action={retireListVersion} fields={{ id }} label="Descontinuar" variant="danger" confirm="Descontinuar esta versão (o histórico permanece)?" /> : null}
    </div>
  );
}

export { AreaF };

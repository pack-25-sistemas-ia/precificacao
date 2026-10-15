'use client';

import { useState } from 'react';
import { addComponent, removeComponent, saveCostVersion, updateComponent } from '@/lib/pricing/actions/costs';
import type { ComponentRow } from '@/lib/pricing/data';
import { ALLOC_HINTS, ALLOC_LABELS, ALLOC_METHODS, COST_TYPE_LABELS, DIRECT_COST_TYPES } from '@/lib/pricing/labels';
import { ActionButton, AreaF, CheckF, PrForm, SelectF, TextF } from './fields';

const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const reaisOf = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',').replace(/,$/, ''));

/** Novo componente de custo. Valor em branco = DESCONHECIDO (não zero): o item fica incompleto até alguém informar. */
export function ComponentForm({ itemId, itemType }: { itemId: string; itemType: 'product' | 'service' }) {
  const [klass, setKlass] = useState<'direct' | 'overhead'>('direct');
  const [method, setMethod] = useState<string>('volume');
  return (
    <PrForm action={addComponent} submit="Adicionar ao rascunho do custo" hidden={{ item_id: itemId, cost_class: klass, ...(klass === 'overhead' ? { cost_type: 'allocated_overhead' } : {}) }}>
      {(f) => (<>
        <div>
          <label htmlFor={f.id('klass')} className="mb-1 block text-sm font-medium">Classe</label>
          <select id={f.id('klass')} value={klass} onChange={(e) => setKlass(e.target.value as 'direct' | 'overhead')} className="min-h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
            <option value="direct">Custo direto / variável</option><option value="overhead">Rateio de estrutura (fixo)</option>
          </select>
        </div>
        <TextF f={f} name="name" label="Nome do componente" required max={120} placeholder={itemType === 'service' ? 'Ex.: Hora técnica' : 'Ex.: Compra do lote'} />
        {klass === 'direct' ? <SelectF f={f} name="cost_type" label="Tipo" opts={DIRECT_COST_TYPES.map((t) => ({ value: t, label: COST_TYPE_LABELS[t] }))} def="acquisition" /> : (
          <div>
            <label htmlFor={f.id('alloc')} className="mb-1 block text-sm font-medium">Método de rateio</label>
            <select id={f.id('alloc')} name="allocation_method" value={method} onChange={(e) => setMethod(e.target.value)} className="min-h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
              {ALLOC_METHODS.map((m) => <option key={m} value={m}>{ALLOC_LABELS[m]}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">{ALLOC_HINTS[method as keyof typeof ALLOC_HINTS]}</p>
          </div>
        )}
        <TextF f={f} name="amount" label={klass === 'overhead' ? 'Valor (R$)' : 'Valor total (R$)'} inputMode="decimal" placeholder="Em branco = desconhecido" hint="Até 4 casas (ex.: 0,0125). Não digite 0 se não souber." />
        <TextF f={f} name="quantity" label={klass === 'overhead' ? 'Volume / horas / serviços por mês' : 'Quantidade que o valor cobre'} inputMode="decimal" def="1" hint={klass === 'direct' ? 'Lote de 100 un. por R$ 2.000,00 → 100.' : undefined} />
        <TextF f={f} name="usage" label={klass === 'overhead' ? 'Horas por unidade ou percentual' : 'Consumo por unidade'} inputMode="decimal" def="1" hint={klass === 'direct' ? 'Ex.: 2,5 horas por serviço.' : undefined} />
        <TextF f={f} name="unit" label="Unidade do consumo (opcional)" max={12} placeholder="h, kg, m…" />
      </>)}
    </PrForm>
  );
}

export function ComponentRowForm({ c }: { c: ComponentRow }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <PrForm action={updateComponent} submit="Salvar" reset={false} hidden={{ id: c.id }} className="flex flex-wrap items-end gap-3">
        {(f) => (<>
          <TextF f={f} name="name" label="Nome" required max={120} def={c.name} />
          <TextF f={f} name="amount" label="Valor (R$)" inputMode="decimal" def={reaisOf(c.amount_cents)} placeholder="desconhecido" />
          <TextF f={f} name="quantity" label="Quantidade" inputMode="decimal" def={num(c.quantity)} />
          <TextF f={f} name="usage" label="Consumo" inputMode="decimal" def={num(c.usage)} />
          <CheckF f={f} name="active" label="Ativo" def={c.active} />
        </>)}
      </PrForm>
      <ActionButton action={removeComponent} fields={{ id: c.id }} label="Remover" variant="danger" confirm="Remover do rascunho? (versões salvas não mudam)" />
    </div>
  );
}

export function SaveVersionForm({ itemId, blocked }: { itemId: string; blocked?: string }) {
  return (
    <PrForm action={saveCostVersion} submit="Salvar versão do custo" reset hidden={{ item_id: itemId }} className="grid gap-3 sm:grid-cols-4">
      {(f) => (<>
        <AreaF f={f} name="note" label="Observação da versão (opcional)" max={300} hint={blocked ?? 'A versão salva é imutável. Alterar o rascunho depois não muda versões antigas.'} />
      </>)}
    </PrForm>
  );
}

'use client';

import { useState } from 'react';
import {
  createCategory, createChannel, createFeeRule, createItem, saveSettings, saveTaxProfile, setItemArchived, updateCategory, updateChannel, updateFeeRule, updateItem,
} from '@/lib/pricing/actions/catalog';
import { createAssignment, createPolicy, deleteAssignment, publishPolicy, retirePolicy, updatePolicy } from '@/lib/pricing/actions/policies';
import type { CategoryRow, ChannelRow, FeeRuleRow, ItemRow, PolicyRow, PrSettings, TaxProfileRow } from '@/lib/pricing/data';
import { CHANNEL_TYPES, CHANNEL_TYPE_LABELS, FEE_BASES, FEE_BASIS_LABELS, FEE_KINDS, FEE_KIND_LABELS, ROUNDING_LABELS, ROUNDING_RULES } from '@/lib/pricing/labels';
import { TAX_SLOTS } from '@/lib/pricing/schemas';
import type { Opt } from './bits';
import { ActionButton, AreaF, CheckF, PrForm, SelectF, TextF } from './fields';

const pt = (n: number | string | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const reais = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ','));
const roundingOpts: Opt[] = ROUNDING_RULES.map((r) => ({ value: r, label: ROUNDING_LABELS[r] }));

export function CategoryForm({ categories }: { categories: Opt[] }) {
  return (
    <PrForm action={createCategory} submit="Criar categoria">
      {(f) => (<>
        <TextF f={f} name="name" label="Nome" required max={80} />
        <SelectF f={f} name="parent_id" label="Categoria-pai (opcional)" opts={categories} placeholder="— nenhuma —" />
        <TextF f={f} name="description" label="Descrição (opcional)" max={300} span />
      </>)}
    </PrForm>
  );
}
export function CategoryEditForm({ category, categories }: { category: CategoryRow; categories: Opt[] }) {
  return (
    <PrForm action={updateCategory} submit="Salvar" reset={false} hidden={{ id: category.id }} className="grid items-end gap-3 sm:grid-cols-4">
      {(f) => (<>
        <TextF f={f} name="name" label="Nome" required max={80} def={category.name} />
        <SelectF f={f} name="parent_id" label="Categoria-pai" opts={categories.filter((c) => c.value !== category.id)} def={category.parent_id} placeholder="— nenhuma —" />
        <TextF f={f} name="description" label="Descrição" max={300} def={category.description} />
        <CheckF f={f} name="active" label="Ativa" def={category.active} />
      </>)}
    </PrForm>
  );
}

export function ItemForm({ item, categories, type }: { item?: ItemRow; categories: Opt[]; type?: 'product' | 'service' }) {
  const editing = Boolean(item);
  return (
    <PrForm action={editing ? updateItem : createItem} submit={editing ? 'Salvar item' : 'Cadastrar'} reset={!editing} hidden={item ? { id: item.id } : type ? { item_type: type } : undefined}>
      {(f) => (<>
        <TextF f={f} name="sku" label={type === 'service' || item?.item_type === 'service' ? 'Código' : 'SKU'} required max={40} def={item?.sku} hint="Único por empresa (ignora maiúsculas)." />
        <TextF f={f} name="name" label="Nome" required max={160} def={item?.name} span />
        <TextF f={f} name="unit" label={type === 'service' || item?.item_type === 'service' ? 'Unidade de cobrança' : 'Unidade'} required max={12} def={item?.unit ?? (type === 'service' ? 'h' : 'un')} hint="Ex.: un, kg, h, serviço." />
        <SelectF f={f} name="category_id" label="Categoria" opts={categories} def={item?.category_id} placeholder="— sem categoria —" />
        {item ? <SelectF f={f} name="status" label="Situação" opts={[{ value: 'active', label: 'Ativo' }, { value: 'inactive', label: 'Inativo' }]} def={item.status} hint="Só gestor ou administrador inativa." /> : null}
        <AreaF f={f} name="description" label="Descrição (opcional)" def={item?.description} max={1000} />
      </>)}
    </PrForm>
  );
}
export const ArchiveItemButton = ({ item }: { item: ItemRow }) => (
  <ActionButton action={setItemArchived} fields={{ id: item.id, archive: item.archived_at ? '0' : '1' }} label={item.archived_at ? 'Reativar item' : 'Arquivar item'} variant={item.archived_at ? 'secondary' : 'danger'}
    confirm={item.archived_at ? undefined : 'Arquivar mantém todo o histórico. Confirmar?'} />
);

export function ChannelForm({ channel, taxProfiles }: { channel?: ChannelRow; taxProfiles: Opt[] }) {
  return (
    <PrForm action={channel ? updateChannel : createChannel} submit={channel ? 'Salvar canal' : 'Criar canal'} reset={!channel} hidden={channel ? { id: channel.id } : undefined}>
      {(f) => (<>
        <TextF f={f} name="name" label="Nome" required max={80} def={channel?.name} />
        <SelectF f={f} name="channel_type" label="Tipo" opts={CHANNEL_TYPES.map((t) => ({ value: t, label: CHANNEL_TYPE_LABELS[t] }))} def={channel?.channel_type ?? 'other'} />
        <SelectF f={f} name="tax_profile_id" label="Perfil tributário informado" opts={taxProfiles} def={channel?.tax_profile_id} placeholder="— nenhum —" hint="Parâmetros que você informou; não é cálculo fiscal." />
        {channel ? <CheckF f={f} name="active" label="Canal ativo" def={channel.active} /> : null}
        <TextF f={f} name="description" label="Descrição (opcional)" max={300} def={channel?.description} span />
      </>)}
    </PrForm>
  );
}

export function FeeRuleForm({ channels, channelId }: { channels: Opt[]; channelId?: string }) {
  const [basis, setBasis] = useState<string>('price');
  const rateBasis = basis === 'price' || basis === 'net_price' || basis === 'cost';
  return (
    <PrForm action={createFeeRule} submit="Cadastrar taxa">
      {(f) => (<>
        <SelectF f={f} name="channel_id" label="Canal" opts={channels} def={channelId} required />
        <TextF f={f} name="name" label="Nome da taxa" required max={80} placeholder="Ex.: Comissão do marketplace" />
        <SelectF f={f} name="fee_type" label="Tipo" opts={FEE_KINDS.filter((k) => k !== 'tax').map((k) => ({ value: k, label: FEE_KIND_LABELS[k] }))} def="commission" hint="Tributos informados ficam no perfil tributário." />
        <div>
          <label htmlFor={f.id('basis')} className="mb-1 block text-sm font-medium">Base de incidência</label>
          <select id={f.id('basis')} name="basis" value={basis} onChange={(e) => setBasis(e.target.value)} className="min-h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
            {FEE_BASES.map((b) => <option key={b} value={b}>{FEE_BASIS_LABELS[b]}</option>)}
          </select>
        </div>
        {rateBasis ? <TextF f={f} name="rate" label="Percentual (%)" inputMode="decimal" placeholder="Ex.: 15" hint="Entre 0 e 100." /> : <TextF f={f} name="fixed" label="Valor fixo (R$)" inputMode="decimal" placeholder="Ex.: 2,00" />}
        {rateBasis ? <TextF f={f} name="min" label="Mínimo por transação (R$, opcional)" inputMode="decimal" /> : null}
        {rateBasis ? <TextF f={f} name="max" label="Teto por transação (R$, opcional)" inputMode="decimal" /> : null}
        <TextF f={f} name="priority" label="Prioridade de exibição" inputMode="numeric" def="100" />
        <TextF f={f} name="valid_from" label="Vigente desde (opcional)" type="date" />
        <TextF f={f} name="valid_until" label="Vigente até (opcional)" type="date" />
      </>)}
    </PrForm>
  );
}
export function FeeRuleRowForm({ rule }: { rule: FeeRuleRow }) {
  return (
    <PrForm action={updateFeeRule} submit="Salvar" reset={false} hidden={{ id: rule.id }} className="flex flex-wrap items-end gap-3">
      {(f) => (<><TextF f={f} name="name" label="Nome" required max={80} def={rule.name} /><CheckF f={f} name="active" label="Ativa" def={rule.active} /></>)}
    </PrForm>
  );
}

export function TaxProfileForm({ profile }: { profile?: TaxProfileRow }) {
  const taxes = profile?.configuration_json.taxes ?? [];
  return (
    <PrForm action={saveTaxProfile} submit="Salvar perfil" reset={!profile} hidden={profile ? { id: profile.id } : undefined}>
      {(f) => (<>
        <TextF f={f} name="name" label="Nome do perfil" required max={80} def={profile?.name} span />
        <TextF f={f} name="description" label="Descrição (opcional)" max={500} def={profile?.description} span />
        <div className="sm:col-span-4 space-y-2">
          <p className="text-sm font-medium">Tributos informados por você</p>
          <p className="text-xs text-muted">Alíquotas e origem são responsabilidade sua (valide com seu contador). O sistema trata cada linha como uma taxa percentual sobre o preço ou sobre o preço líquido; não calcula tributo oficial.</p>
          {Array.from({ length: TAX_SLOTS }, (_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-4">
              <TextF f={f} name={`tax_${i}_name`} label={`Tributo ${i + 1}`} max={80} def={taxes[i]?.name} />
              <TextF f={f} name={`tax_${i}_rate`} label="Alíquota (%)" inputMode="decimal" def={pt(taxes[i]?.rate_pct)} />
              <SelectF f={f} name={`tax_${i}_basis`} label="Base" opts={[{ value: 'price', label: '% sobre o preço' }, { value: 'net_price', label: '% sobre o preço líquido' }]} def={taxes[i]?.basis ?? 'price'} />
              <TextF f={f} name={`tax_${i}_source`} label="Origem do parâmetro" max={200} def={taxes[i]?.source} placeholder="Ex.: orientação do contador, 10/2026" />
            </div>
          ))}
        </div>
      </>)}
    </PrForm>
  );
}

export function PolicyForm({ policy }: { policy?: PolicyRow }) {
  return (
    <PrForm action={policy ? updatePolicy : createPolicy} submit={policy ? 'Salvar rascunho' : 'Criar política'} reset={!policy} hidden={policy ? { id: policy.id } : undefined}>
      {(f) => (<>
        <TextF f={f} name="name" label="Nome" required max={80} def={policy?.name} span />
        <SelectF f={f} name="rounding" label="Arredondamento do preço" opts={roundingOpts} def={policy?.rounding_rule ?? 'nearest'} span />
        <TextF f={f} name="target" label="Margem-alvo (%)" inputMode="decimal" required def={pt(policy?.target_margin_decimal)} hint="Margem de contribuição desejada." />
        <TextF f={f} name="minimum" label="Margem mínima (%)" inputMode="decimal" required def={pt(policy?.minimum_margin_decimal)} hint="Abaixo dela o preço não é publicado." />
        <TextF f={f} name="max_discount" label="Desconto máximo (%)" inputMode="decimal" def={pt(policy?.max_discount_decimal)} hint="Opcional." />
        <TextF f={f} name="min_price" label="Preço mínimo autorizado (R$)" inputMode="decimal" def={reais(policy?.min_price_cents)} hint="Opcional; piso absoluto." />
        <TextF f={f} name="description" label="Descrição (opcional)" max={500} def={policy?.description} span />
      </>)}
    </PrForm>
  );
}
export const PolicyButtons = ({ policy, canPublish }: { policy: PolicyRow; canPublish: boolean }) => (
  <div className="flex flex-wrap gap-2">
    {canPublish && policy.status !== 'retired' ? <ActionButton action={publishPolicy} fields={{ id: policy.id }} label={policy.status === 'draft' ? 'Publicar versão' : 'Publicar nova versão'} variant="primary" confirm="Publicar cria uma versão imutável com os valores do rascunho. Confirmar?" /> : null}
    {canPublish && policy.status !== 'retired' ? <ActionButton action={retirePolicy} fields={{ id: policy.id }} label="Aposentar" variant="danger" confirm="A política deixa de valer (o histórico fica). Confirmar?" /> : null}
  </div>
);

export function AssignmentForm({ policies, items, categories, channels }: { policies: Opt[]; items: Opt[]; categories: Opt[]; channels: Opt[] }) {
  return (
    <PrForm action={createAssignment} submit="Atribuir política">
      {(f) => (<>
        <SelectF f={f} name="policy_id" label="Política" opts={policies} required />
        <SelectF f={f} name="item_id" label="Item (opcional)" opts={items} placeholder="— todos —" />
        <SelectF f={f} name="category_id" label="Categoria (opcional)" opts={categories} placeholder="— todas —" hint="Não combine com item." />
        <SelectF f={f} name="channel_id" label="Canal (opcional)" opts={channels} placeholder="— todos —" />
        <TextF f={f} name="valid_from" label="Vigente desde (opcional)" type="date" />
        <TextF f={f} name="valid_until" label="Vigente até (opcional)" type="date" />
      </>)}
    </PrForm>
  );
}
export const DeleteAssignmentButton = ({ id }: { id: string }) => <ActionButton action={deleteAssignment} fields={{ id }} label="Remover" variant="danger" confirm="Remover esta atribuição?" />;

export function SettingsForm({ settings }: { settings: PrSettings }) {
  return (
    <PrForm action={saveSettings} submit="Salvar configurações" reset={false}>
      {(f) => (<>
        <TextF f={f} name="default_target_margin_pct" label="Margem-alvo padrão (%)" inputMode="decimal" required def={pt(settings.default_target_margin_pct)} hint="Vale quando nenhuma política se aplica." />
        <TextF f={f} name="default_minimum_margin_pct" label="Margem mínima padrão (%)" inputMode="decimal" required def={pt(settings.default_minimum_margin_pct)} />
        <SelectF f={f} name="default_rounding" label="Arredondamento padrão" opts={roundingOpts} def={settings.default_rounding} />
        <TextF f={f} name="price_review_days" label="Revisar preços a cada (dias)" inputMode="numeric" required def={String(settings.price_review_days)} />
        <TextF f={f} name="near_minimum_margin_pp" label="Faixa «próximo da mínima» (p.p.)" inputMode="decimal" required def={pt(settings.near_minimum_margin_pp)} />
        <div className="sm:col-span-3"><CheckF f={f} name="segregation_of_duties" label="Segregação de funções: quem propõe não aprova a própria alteração (recomendado)" def={settings.segregation_of_duties} /></div>
      </>)}
    </PrForm>
  );
}

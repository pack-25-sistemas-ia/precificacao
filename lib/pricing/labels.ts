// Rótulos em português e permissões de tela (o banco autoriza de verdade; aqui só decidimos o que mostrar).
import type { OrgRole } from '@/lib/validation/org';

export type ItemType = 'product' | 'service';
export const ITEM_TYPE_LABELS: Record<ItemType, string> = { product: 'Produto', service: 'Serviço' };

export const CHANNEL_TYPES = ['physical_store', 'own_site', 'marketplace', 'b2b_direct', 'representative', 'other'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  physical_store: 'Loja física', own_site: 'Site próprio', marketplace: 'Marketplace', b2b_direct: 'Venda direta B2B', representative: 'Representante', other: 'Outro canal',
};

export const DIRECT_COST_TYPES = ['acquisition', 'raw_material', 'direct_labor', 'packaging', 'acquisition_freight', 'supply', 'outsourced_service', 'other_direct'] as const;
export type DirectCostType = (typeof DIRECT_COST_TYPES)[number];
export const COST_TYPE_LABELS: Record<DirectCostType | 'allocated_overhead', string> = {
  acquisition: 'Aquisição', raw_material: 'Matéria-prima', direct_labor: 'Mão de obra direta', packaging: 'Embalagem', acquisition_freight: 'Frete de aquisição',
  supply: 'Insumo', outsourced_service: 'Serviço terceirizado', other_direct: 'Outro custo direto', allocated_overhead: 'Rateio de estrutura',
};

export const ALLOC_METHODS = ['volume', 'services', 'hours', 'percent', 'manual'] as const;
export type AllocMethod = (typeof ALLOC_METHODS)[number];
export const ALLOC_LABELS: Record<AllocMethod, string> = {
  volume: 'Por volume previsto', services: 'Por quantidade de serviços', hours: 'Por horas produtivas', percent: 'Por percentual do custo direto', manual: 'Valor manual por unidade',
};
export const ALLOC_HINTS: Record<AllocMethod, string> = {
  volume: 'Valor mensal ÷ volume previsto por mês (campo «Quantidade»).',
  services: 'Valor mensal ÷ serviços por mês (campo «Quantidade»).',
  hours: 'Valor mensal ÷ horas produtivas por mês (Quantidade) × horas por unidade (Consumo).',
  percent: 'Percentual do custo direto unitário (informe o percentual em «Consumo»; o valor fica em branco).',
  manual: 'O valor informado já é o rateio por unidade.',
};

export const FEE_KINDS = ['commission', 'payment', 'platform', 'shipping_subsidy', 'transaction', 'tax', 'other'] as const;
export type FeeKindKey = (typeof FEE_KINDS)[number];
export const FEE_KIND_LABELS: Record<FeeKindKey, string> = {
  commission: 'Comissão', payment: 'Taxa de pagamento', platform: 'Taxa de plataforma', shipping_subsidy: 'Frete subsidiado', transaction: 'Taxa por transação', tax: 'Tributo informado', other: 'Outra taxa',
};
export const FEE_BASES = ['price', 'net_price', 'cost', 'fixed_unit', 'fixed_transaction'] as const;
export type FeeBasisKey = (typeof FEE_BASES)[number];
export const FEE_BASIS_LABELS: Record<FeeBasisKey, string> = {
  price: '% sobre o preço de venda', net_price: '% sobre o preço líquido de taxas', cost: '% sobre o custo variável', fixed_unit: 'Valor fixo por unidade', fixed_transaction: 'Valor fixo por transação',
};

export const ROUNDING_RULES = ['nearest', 'up', 'down', 'charm_90', 'charm_99'] as const;
export const ROUNDING_LABELS: Record<(typeof ROUNDING_RULES)[number], string> = {
  nearest: 'Ao centavo mais próximo', up: 'Sempre para cima (garante a meta)', down: 'Sempre para baixo', charm_90: 'Terminar em ,90 (para cima)', charm_99: 'Terminar em ,99 (para cima)',
};

export const REQUEST_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', pending: 'Aguardando aprovação', approved: 'Aprovado', rejected: 'Rejeitado', published: 'Publicado', cancelled: 'Cancelado' };
export const LIST_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', pending: 'Aguardando aprovação', approved: 'Aprovada', rejected: 'Rejeitada', published: 'Publicada', retired: 'Descontinuada' };
export const POLICY_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', published: 'Publicada', retired: 'Aposentada' };
export const FLAG_LABELS: Record<string, string> = {
  negative_contribution: 'Contribuição negativa', below_minimum_margin: 'Margem abaixo da mínima', below_min_price: 'Abaixo do preço mínimo autorizado', missing_cost: 'Sem versão de custo', inactive_item: 'Item inativo',
};
export const SOURCE_LABELS: Record<string, string> = { manual: 'Manual', import: 'Importação', scenario: 'Cenário' };

export const NOTIFICATION_TYPES: Record<string, string> = {
  approval_pending: 'Aprovações pendentes', price_approved: 'Preços aprovados', price_rejected: 'Preços rejeitados', price_published: 'Preços publicados', cost_increase: 'Aumento de custo', import_done: 'Importações concluídas',
};

export type Perms = { read: boolean; analyst: boolean; manager: boolean; admin: boolean };
export function can(role: OrgRole): Perms {
  return {
    read: true,
    analyst: role === 'owner' || role === 'admin' || role === 'manager' || role === 'member',
    manager: role === 'owner' || role === 'admin' || role === 'manager',
    admin: role === 'owner' || role === 'admin',
  };
}

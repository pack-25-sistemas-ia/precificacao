// Configuração da Precificação Inteligente. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Papéis do Core → perfis de precificação: owner/admin = Administrador; manager = Gestor comercial;
// member = Analista de precificação; viewer = Consulta (ver docs/PERMISSIONS.md).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
// Itens de menu entram junto com as telas reais de cada módulo (nenhum link para página inexistente).
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Precificação Inteligente',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/produtos', label: 'Produtos' },
    { href: '/servicos', label: 'Serviços' },
    { href: '/custos', label: 'Custos' },
    { href: '/canais', label: 'Canais' },
    { href: '/taxas', label: 'Taxas e tributos' },
    { href: '/regras', label: 'Políticas de preço' },
    { href: '/listas-precos', label: 'Listas de preços' },
    { href: '/simulador', label: 'Simulador' },
    { href: '/cenarios', label: 'Cenários' },
    { href: '/aprovacoes', label: 'Aprovações' },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/importacoes', label: 'Importações', roles: ['owner', 'admin', 'manager', 'member'] },
    { href: '/notificacoes', label: 'Avisos' },
    { href: '/configuracoes', label: 'Config. de preços', roles: ['owner', 'admin'] },
  ],
};

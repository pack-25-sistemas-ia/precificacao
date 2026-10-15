#!/usr/bin/env node
// Gera supabase/seed.sql — dados de DEMONSTRAÇÃO fictícios e determinísticos da «Aurora Variedades e Serviços Ltda.».
// Rode: node scripts/gen-seed.mjs
//
// Princípio: custos, preços, políticas, listas e cenários nascem pelas MESMAS funções do sistema (pr_save_cost_version, pr_request_price_change,
// pr_review_price_change, pr_publish_price_change, pr_publish_policy, pr_*_list_version, pr_save_scenario), com a sessão do usuário simulada por claims.
// Assim as regras (margem mínima, segregação, versões, auditoria) valem também para os dados de demonstração.
// Só o RETRATO NO TEMPO é ajustado depois (datas de versões, eventos e solicitações), com os gatilhos de imutabilidade desligados APENAS durante o seed
// (e religados no fim): o histórico precisa parecer ter meses de uso para os gráficos de evolução. Datas relativas ao dia da criação do banco.
// Só vale para ambiente local/demonstração: usuários @demo.exemplo com senha local. NUNCA use em produção.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sq = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

let seed = 20270801;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;

export const ORG = 'e8e8e8e8-0000-4000-8000-000000000001';
const uid = (k) => `e8e8e8e8-0000-4000-8000-000000000${k}`;
const U = { owner: '0a1', manager: '0a2', analyst: '0a3', viewer: '0a4', analyst2: '0a5' };

// ---------------------------------------------------------------------------- canais e taxas (valores FICTÍCIOS de demonstração)
const CHANNELS = [
  { key: 'LOJA', name: 'Loja física', type: 'physical_store', tax: true, fees: [['Taxa de cartão', 'payment', 'price', 2.5, null, null, null]] },
  { key: 'SITE', name: 'Site próprio', type: 'own_site', tax: true, fees: [['Gateway de pagamento', 'payment', 'price', 3.2, null, null, null], ['Taxa fixa do gateway', 'transaction', 'fixed_unit', null, 39, null, null]] },
  { key: 'MKA', name: 'Marketplace Alfa', type: 'marketplace', tax: false, fees: [['Comissão Alfa', 'commission', 'price', 14, null, null, null], ['Tarifa fixa Alfa', 'transaction', 'fixed_unit', null, 600, null, null], ['Pagamento Alfa', 'payment', 'price', 2, null, null, null]] },
  { key: 'MKB', name: 'Marketplace Beta', type: 'marketplace', tax: false, fees: [['Comissão Beta', 'commission', 'price', 18, null, null, 4000], ['Frete subsidiado Beta', 'shipping_subsidy', 'fixed_unit', null, 890, null, null]] },
  { key: 'B2B', name: 'Venda direta B2B', type: 'b2b_direct', tax: true, fees: [['Comissão do representante', 'commission', 'price', 5, null, null, null]] },
];
const TAX_PCT = 4.5; // perfil tributário INFORMADO (fictício) aplicado a loja, site e B2B

// ---------------------------------------------------------------------------- catálogo: [categoria-pai, subcategoria, prefixo, [[nome, custo unitário R$, embalagem R$, frete R$]]]
const PRODUCTS = [
  ['Eletrônicos', 'Acessórios', 'ELE', [['Cabo USB-C 1 m', 12.9, 0.6, 0.4], ['Carregador 20 W', 34.9, 1.2, 0.9], ['Fone de ouvido com fio', 18.5, 0.9, 0.5], ['Caixa de som portátil', 79, 3.5, 2.1], ['Power bank 10000 mAh', 64, 2.4, 1.8], ['Suporte veicular', 21.5, 1.1, 0.7], ['Mouse sem fio', 29.9, 1.4, 0.8], ['Teclado compacto', 49.9, 2.2, 1.2], ['Hub USB 4 portas', 38.2, 1.5, 0.9], ['Webcam HD', 89, 3.2, 2.2]]],
  ['Casa e cozinha', 'Utensílios', 'CAS', [['Jogo de facas 3 peças', 42, 2.8, 1.6], ['Tábua de corte bambu', 28.5, 2.1, 1.4], ['Panela antiaderente 24 cm', 69.9, 3.4, 2.8], ['Garrafa térmica 1 L', 47, 2.5, 1.9], ['Conjunto de potes 5 un.', 33.5, 2.6, 1.7], ['Escorredor de louça', 36.8, 3.1, 2.2], ['Pano de prato (kit 4)', 15.4, 0.7, 0.6], ['Lixeira com pedal 5 L', 24.9, 2.0, 1.5], ['Organizador de gavetas', 19.9, 1.2, 0.9], ['Frigideira 26 cm', 54, 2.9, 2.3]]],
  ['Papelaria', 'Escritório', 'PAP', [['Caderno 96 folhas', 9.8, 0.4, 0.3], ['Caneta gel (cx 12)', 17.5, 0.8, 0.4], ['Agenda executiva', 26.9, 1.3, 0.7], ['Pasta classificadora', 6.4, 0.3, 0.2], ['Papel A4 500 folhas', 22.4, 1.1, 0.9], ['Marcador de texto (cx 6)', 11.2, 0.5, 0.3], ['Grampeador', 24.5, 1.4, 0.8], ['Bloco adesivo', 5.9, 0.2, 0.2]]],
  ['Brinquedos', 'Educativos', 'BRI', [['Quebra-cabeça 200 peças', 21, 1.2, 0.9], ['Jogo de memória', 14.9, 0.8, 0.5], ['Blocos de montar 100 pç', 38.5, 2.0, 1.4], ['Massinha (kit 12)', 12.8, 0.6, 0.4], ['Dominó de madeira', 17.4, 0.9, 0.7]]],
  ['Beleza', 'Cuidados pessoais', 'BEL', [['Shampoo 350 ml', 11.9, 0.5, 0.5], ['Hidratante 200 ml', 14.5, 0.6, 0.5], ['Protetor solar FPS 50', 31.9, 0.9, 0.7], ['Kit de escovas', 22.8, 1.1, 0.6], ['Sabonete líquido 250 ml', 8.9, 0.4, 0.4]]],
];
// serviços: [prefixo, nome, horas por serviço, valor/hora (custo direto), materiais R$, terceirizado R$]
const SERVICES = [
  ['SRV-001', 'Instalação de ar-condicionado', 3.5, 55, 48, 0], ['SRV-002', 'Manutenção preventiva de computador', 1.5, 48, 6, 0], ['SRV-003', 'Montagem de móveis', 2.5, 38, 4, 0], ['SRV-004', 'Visita técnica residencial', 1, 52, 0, 0],
  ['SRV-005', 'Configuração de rede Wi-Fi', 2, 58, 12, 0], ['SRV-006', 'Instalação elétrica (ponto)', 1.8, 62, 22, 0], ['SRV-007', 'Limpeza pós-obra (m²)', 0.25, 34, 3.2, 0], ['SRV-008', 'Consultoria em organização de estoque', 4, 90, 0, 0],
  ['SRV-009', 'Treinamento de equipe (turma)', 6, 85, 25, 120], ['SRV-010', 'Design de identidade visual', 12, 70, 0, 150], ['SRV-011', 'Pintura de ambiente (m²)', 0.4, 36, 9.5, 0], ['SRV-012', 'Revisão contábil gerencial', 3, 95, 0, 0],
  ['SRV-013', 'Entrega expressa urbana', 0.8, 32, 2.5, 0], ['SRV-014', 'Reparo hidráulico', 1.5, 54, 14, 0], ['SRV-015', 'Suporte remoto mensal', 2, 60, 0, 0],
];
const OVERHEAD_MONTHLY = 12000; // aluguel e administração (R$/mês)
const VOLUME_PER_MONTH = 1500;
const HOURS_PER_MONTH = 480;

const items = []; // { sku, name, type, cat, sub, unit, costs:{...}, svc }
PRODUCTS.forEach(([cat, sub, pre, list]) => list.forEach(([name, cost, pack, freight], i) => items.push({ sku: `${pre}-${String(i + 1).padStart(3, '0')}`, name, type: 'product', cat, sub, unit: 'un', cost, pack, freight })));
SERVICES.forEach(([sku, name, hours, rate, mat, outs]) => items.push({ sku, name, type: 'service', cat: 'Serviços', sub: null, unit: 'un', hours, rate, mat, outs }));
const NO_COST = { sku: 'ELE-099', name: 'Produto recém-cadastrado (sem custo)', type: 'product', cat: 'Eletrônicos', sub: 'Acessórios', unit: 'un', noCost: true };
const UNKNOWN_COST = { sku: 'CAS-099', name: 'Produto com custo em levantamento', type: 'product', cat: 'Casa e cozinha', sub: 'Utensílios', unit: 'un', cost: 25, pack: 1, freight: null, unknownFreight: true };
items.push(NO_COST, UNKNOWN_COST);

// margens-alvo práticas por categoria (alimentam os preços iniciais; a política vigente decide o resto)
const TARGET = { Eletrônicos: 30, 'Casa e cozinha': 33, Papelaria: 38, Brinquedos: 36, Beleza: 40, Serviços: 50 };
const feePctOf = (c) => CHANNELS.find((x) => x.key === c).fees.filter((f) => f[2] === 'price').reduce((s, f) => s + f[3], 0) + (CHANNELS.find((x) => x.key === c).tax ? TAX_PCT : 0);
const fixedOf = (c) => CHANNELS.find((x) => x.key === c).fees.filter((f) => f[2] === 'fixed_unit').reduce((s, f) => s + f[4], 0);
const unitCostCents = (it, factor = 1) => Math.round(((it.cost + (it.pack ?? 0) + (it.freight ?? 0)) * 100) * factor);
const svcCostCents = (it, factor = 1) => Math.round((it.hours * it.rate + it.mat + it.outs) * 100 * factor);
const costOf = (it, f = 1) => (it.type === 'service' ? svcCostCents(it, f) : unitCostCents(it, f));
/** Preço para a margem-alvo (aproximação por fórmula fechada; o banco valida de verdade). Termina em ,90. */
const priceFor = (it, ch, factor = 1, extraMargin = 0) => {
  const m = (TARGET[it.cat] ?? 30) + extraMargin;
  const denom = 1 - feePctOf(ch) / 100 - m / 100;
  const raw = (costOf(it, factor) + fixedOf(ch)) / denom;
  return Math.ceil(raw / 100) * 100 - 10; // 12.90, 83.90…
};

const sql = [];
const add = (s) => sql.push(s);
const CHAN_FOR = (it) => {
  // cada item vende em 2 a 4 canais; marketplaces e site só para produtos
  const pool = it.type === 'service' ? ['LOJA', 'B2B'] : ['LOJA', 'SITE', 'MKA', 'MKB', 'B2B'];
  const n = it.type === 'service' ? int(1, 2) : int(2, 4);
  const c = ['LOJA']; for (const k of pool) if (k !== 'LOJA' && c.length < n && chance(0.7)) c.push(k);
  return c;
};

// ---------------------------------------------------------------------------- funções auxiliares do seed (pg_temp: somem ao fim da sessão)
const helpers = `
create function pg_temp.org() returns uuid language sql as $f$ select '${ORG}'::uuid $f$;
create function pg_temp.as_user(p_id text, p_aal text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'aal', p_aal, 'role', 'authenticated')::text, true) $f$;
create function pg_temp.as_owner() returns void language sql as $f$ select pg_temp.as_user('${uid(U.owner)}', 'aal2') $f$;
create function pg_temp.as_manager() returns void language sql as $f$ select pg_temp.as_user('${uid(U.manager)}', 'aal1') $f$;
create function pg_temp.as_analyst() returns void language sql as $f$ select pg_temp.as_user('${uid(U.analyst)}', 'aal1') $f$;
create function pg_temp.as_analyst2() returns void language sql as $f$ select pg_temp.as_user('${uid(U.analyst2)}', 'aal1') $f$;
create function pg_temp.ts(p_days int) returns timestamptz language sql as $f$
  select least((((now() at time zone 'America/Sao_Paulo')::date - p_days)::timestamp + interval '10 hours 30 minutes') at time zone 'America/Sao_Paulo', now() - interval '1 minute') $f$;
create function pg_temp.item(p_sku text) returns uuid language sql as $f$ select id from public.pricing_items where organization_id = pg_temp.org() and sku = p_sku $f$;
create function pg_temp.chan(p_key text) returns uuid language sql as $f$ select id from public.sales_channels where organization_id = pg_temp.org() and name = (select n from (values
  ('LOJA', 'Loja física'), ('SITE', 'Site próprio'), ('MKA', 'Marketplace Alfa'), ('MKB', 'Marketplace Beta'), ('B2B', 'Venda direta B2B')) as t(k, n) where k = p_key) $f$;

-- Componente de custo direto/estrutura (rascunho). amount em CENTAVOS; null = desconhecido.
create function pg_temp.comp(p_sku text, p_class text, p_type text, p_name text, p_amount numeric, p_qty numeric, p_usage numeric, p_method text) returns void language plpgsql as $f$
begin
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity, usage, allocation_method)
  values (pg_temp.org(), pg_temp.item(p_sku), p_class::public.pr_cost_class, p_type::public.pr_cost_type, p_name, p_amount, p_qty, p_usage, p_method::public.pr_alloc_method);
end $f$;
create function pg_temp.setcost(p_sku text, p_name text, p_amount numeric) returns void language plpgsql as $f$
begin update public.cost_components set amount_cents = p_amount where item_id = pg_temp.item(p_sku) and name = p_name; end $f$;

-- Salva a versão de custo e leva a versão para o passado (o gatilho de imutabilidade é religado ao fim do seed).
create function pg_temp.version(p_sku text, p_days int, p_note text) returns void language plpgsql as $f$
declare v uuid;
begin
  v := public.pr_save_cost_version(pg_temp.org(), pg_temp.item(p_sku), p_note);
  update public.cost_model_versions set created_at = pg_temp.ts(p_days) where id = v;
end $f$;

-- Preço: propõe (analista), aprova (gestor) e publica (gestor); datas levadas ao passado. Segue as regras reais (margem mínima, segregação).
create function pg_temp.price(p_sku text, p_chan text, p_cents bigint, p_days int, p_why text) returns void language plpgsql as $f$
declare r uuid; c uuid := case when p_chan is null then null else pg_temp.chan(p_chan) end;
begin
  perform pg_temp.as_analyst();
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item(p_sku), c, p_cents, p_why, 'manual');
  perform pg_temp.as_manager();
  perform public.pr_review_price_change(pg_temp.org(), r, true, 'Conferido com a política vigente.');
  perform public.pr_publish_price_change(pg_temp.org(), r);
  update public.price_change_requests set requested_at = pg_temp.ts(p_days + 1), reviewed_at = pg_temp.ts(p_days), published_at = pg_temp.ts(p_days) where id = r;
  update public.price_change_events set effective_at = pg_temp.ts(p_days), created_at = pg_temp.ts(p_days) where request_id = r;
  update public.pricing_items set price_reviewed_at = pg_temp.ts(p_days) where id = pg_temp.item(p_sku);
  if c is not null then update public.item_channel_prices set reviewed_at = pg_temp.ts(p_days), updated_at = pg_temp.ts(p_days) where item_id = pg_temp.item(p_sku) and channel_id = c; end if;
end $f$;
`;

// ---------------------------------------------------------------------------- pré-sessão: usuários, empresa, cadastros
const prelude = `
do $seed$
declare
  org uuid := '${ORG}';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('${uid(U.owner)}', 'dono@demo.exemplo', 'Helena Duarte'), ('${uid(U.manager)}', 'gestor@demo.exemplo', 'Rodrigo Albuquerque'),
    ('${uid(U.analyst)}', 'analista@demo.exemplo', 'Camila Teixeira'), ('${uid(U.viewer)}', 'consulta@demo.exemplo', 'Otávio Mendes'),
    ('${uid(U.analyst2)}', 'analista2@demo.exemplo', 'Priscila Nogueira')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Aurora Variedades e Serviços Ltda. (dados fictícios)', 'aurora');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Aurora Variedades e Serviços', '{"primary":"#0e7490"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, '${uid(U.owner)}', 'owner'), (org, '${uid(U.manager)}', 'manager'), (org, '${uid(U.analyst)}', 'member'), (org, '${uid(U.viewer)}', 'viewer'), (org, '${uid(U.analyst2)}', 'member');
  -- gatilhos de imutabilidade desligados SÓ durante o seed (para levar o histórico ao passado); religados no fim
  alter table public.cost_model_versions disable trigger append_cost_model_versions;
  alter table public.price_change_events disable trigger append_price_change_events;
  alter table public.price_change_requests disable trigger request_guard;
  -- categorias
  insert into public.product_categories (organization_id, name) values ${[...new Set(items.map((i) => i.cat))].map((c) => `(org, ${sq(c)})`).join(', ')};
  ${[...new Set(items.filter((i) => i.sub).map((i) => `${i.cat}|${i.sub}`))].map((x) => { const [par, nm] = x.split('|'); return `insert into public.product_categories (organization_id, parent_id, name) select org, p.id, ${sq(nm)} from public.product_categories p where p.organization_id = org and p.name = ${sq(par)} and p.parent_id is null;`; }).join('\n  ')}
  -- perfil tributário INFORMADO (fictício) e canais
  insert into public.tax_profiles (organization_id, name, description, configuration_json) values (org, 'Tributos informados pela contabilidade (fictício)', 'Parâmetros de demonstração; não representam nenhuma regra fiscal real.',
    '{"taxes":[{"name":"Tributo sobre vendas (demonstração)","rate_pct":${TAX_PCT},"basis":"price","source":"Orientação FICTÍCIA da contabilidade — apenas para demonstração"}]}'::jsonb);
  ${CHANNELS.map((c) => `insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, ${sq(c.name)}, '${c.type}', ${c.tax ? "(select id from public.tax_profiles where organization_id = org limit 1)" : 'null'});`).join('\n  ')}
  ${CHANNELS.flatMap((c) => c.fees.map((f, i) => `insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, ${sq(f[0])}, '${f[1]}', '${f[2]}', ${f[3] ?? 'null'}, ${f[4] ?? 'null'}, ${f[6] ?? 'null'}, ${(i + 1) * 10} from public.sales_channels ch where ch.organization_id = org and ch.name = ${sq(c.name)};`)).join('\n  ')}
  -- itens (sem preço: o preço nasce pelo fluxo de aprovação)
  ${items.map((it) => `insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, '${it.type}', ${sq(it.sku)}, ${sq(it.name)}, ${sq(it.unit)}, now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = ${sq(it.sub ?? it.cat)}${it.sub ? ' and c.parent_id is not null' : ' and c.parent_id is null'};`).join('\n  ')}
  perform set_config('request.jwt.claims', '{"sub":"${uid(U.owner)}","aal":"aal2","role":"authenticated"}', true);
end $seed$;
`;

// ---------------------------------------------------------------------------- operações (usam as funções do sistema)
const H = { v1: 175, p1: 170, rev1: 120, rev2: 75, rev3: 30, rev4: 8 };
const comp = (sku, cls, type, name, amount, qty = 1, usage = 1, method = 'null') => add(`perform pg_temp.comp(${sq(sku)}, ${sq(cls)}, ${sq(type)}, ${sq(name)}, ${amount === null ? 'null' : amount}, ${qty}, ${usage}, ${method === 'null' ? 'null' : sq(method)});`);

add(`perform pg_temp.as_analyst();`);
for (const it of items) {
  if (it.noCost) continue;
  if (it.type === 'product') {
    comp(it.sku, 'direct', 'acquisition', 'Compra do lote', Math.round(it.cost * 100) * 100, 100, 1);
    comp(it.sku, 'direct', 'packaging', 'Embalagem', Math.round(it.pack * 100));
    comp(it.sku, 'direct', 'acquisition_freight', 'Frete de aquisição', it.unknownFreight ? null : Math.round(it.freight * 100));
    if (chance(0.55)) comp(it.sku, 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', OVERHEAD_MONTHLY * 100, VOLUME_PER_MONTH, 1, 'volume');
  } else {
    comp(it.sku, 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', Math.round(it.rate * 100), 1, it.hours);
    if (it.mat) comp(it.sku, 'direct', 'supply', 'Materiais e insumos', Math.round(it.mat * 100));
    if (it.outs) comp(it.sku, 'direct', 'outsourced_service', 'Serviço terceirizado', Math.round(it.outs * 100));
    comp(it.sku, 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', OVERHEAD_MONTHLY * 100, HOURS_PER_MONTH, it.hours, 'hours');
  }
}
// versão 1 de custo (há ~6 meses); o item com custo desconhecido NÃO salva versão (fica incompleto de verdade)
for (const it of items) if (!it.noCost && !it.unknownFreight) add(`perform pg_temp.version(${sq(it.sku)}, ${H.v1}, 'Levantamento inicial de custos');`);
// o item «em levantamento» salva a versão sem o frete (zero digitado de propósito) e depois ganha um componente desconhecido
add(`perform pg_temp.setcost('CAS-099', 'Frete de aquisição', 0);`);
add(`perform pg_temp.version('CAS-099', ${H.v1}, 'Custo inicial (frete ainda não conhecido: zerado provisoriamente)');`);
add(`perform pg_temp.setcost('CAS-099', 'Frete de aquisição', null);`);
add(`perform pg_temp.comp('CAS-099', 'direct', 'other_direct', 'Taxa de importação (a confirmar)', null, 1, 1, null);`);

// políticas (gestor): padrão, marketplaces, serviços, premium e exceção de item
add(`perform pg_temp.as_manager();`);
add(`insert into public.pricing_policies (organization_id, name, description, target_margin_decimal, minimum_margin_decimal, max_discount_decimal, rounding_rule) values
  (pg_temp.org(), 'Padrão da empresa', 'Margem de contribuição padrão para tudo que não tem regra específica.', 30, 12, 15, 'up'),
  (pg_temp.org(), 'Marketplaces', 'Canais com comissão alta: meta menor, desconto máximo menor.', 24, 10, 8, 'charm_90'),
  (pg_temp.org(), 'Serviços', 'Serviços exigem margem maior por causa da capacidade ocupada.', 48, 30, 10, 'nearest'),
  (pg_temp.org(), 'Eletrônicos premium', 'Eletrônicos de maior valor.', 34, 20, 12, 'charm_90'),
  (pg_temp.org(), 'Exceção da webcam', 'Queima de estoque da webcam HD (item específico).', 20, 10, 20, 'up');`);
for (const n of ['Padrão da empresa', 'Marketplaces', 'Serviços', 'Eletrônicos premium', 'Exceção da webcam']) add(`perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = ${sq(n)}));`);
const polId = (n) => `(select id from public.pricing_policies where organization_id = pg_temp.org() and name = ${sq(n)})`;
add(`insert into public.pricing_rule_assignments (organization_id, policy_id) values (pg_temp.org(), ${polId('Padrão da empresa')});`);
add(`insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id) values (pg_temp.org(), ${polId('Marketplaces')}, pg_temp.chan('MKA')), (pg_temp.org(), ${polId('Marketplaces')}, pg_temp.chan('MKB'));`);
add(`insert into public.pricing_rule_assignments (organization_id, policy_id, category_id) select pg_temp.org(), ${polId('Serviços')}, id from public.product_categories where organization_id = pg_temp.org() and name = 'Serviços';`);
add(`insert into public.pricing_rule_assignments (organization_id, policy_id, category_id) select pg_temp.org(), ${polId('Eletrônicos premium')}, id from public.product_categories where organization_id = pg_temp.org() and name = 'Acessórios' and parent_id is not null and exists (select 1 from public.product_categories p where p.id = parent_id and p.name = 'Eletrônicos');`);
add(`insert into public.pricing_rule_assignments (organization_id, policy_id, item_id) values (pg_temp.org(), ${polId('Exceção da webcam')}, pg_temp.item('ELE-010'));`);

// preços iniciais (há ~170 dias): base para todos e canais escolhidos. O que o banco recusa (margem mínima) é ajustado até passar.
const chans = new Map();
const last = new Map(); // último preço proposto por item × canal (o banco recusa preço igual ao atual)
for (const it of items) {
  if (it.noCost) continue;
  const cs = CHAN_FOR(it);
  chans.set(it.sku, cs);
  const baseCh = cs[0];
  const basePrice = priceFor(it, baseCh) + 100;
  add(`perform pg_temp.price(${sq(it.sku)}, null, ${basePrice}, ${H.p1}, 'Preço inicial do catálogo');`);
  for (const c of cs) { let v = priceFor(it, c); if (v === basePrice) v += 100; last.set(`${it.sku}|${c}`, v); add(`perform pg_temp.price(${sq(it.sku)}, ${sq(c)}, ${v}, ${H.p1 - 1}, 'Preço inicial no canal');`); }
}

// revisões de custo ao longo dos meses (aumentos e algumas reduções) e reajustes de preço
const revs = [[H.rev1, 0.045, 0.5], [H.rev2, 0.06, 0.45], [H.rev3, 0.08, 0.4], [H.rev4, 0.1, 0.3]];
const factor = new Map(items.map((i) => [i.sku, 1]));
for (const [days, step, share] of revs) {
  add(`perform pg_temp.as_analyst();`);
  for (const it of items) {
    if (it.noCost || it.unknownFreight || !chance(share)) continue;
    const f = factor.get(it.sku) * (1 + step * (0.4 + rnd() * 1.2)) * (chance(0.1) ? 0.96 : 1);
    factor.set(it.sku, f);
    if (it.type === 'product') {
      add(`perform pg_temp.setcost(${sq(it.sku)}, 'Compra do lote', ${Math.round(it.cost * 100 * f) * 100});`);
      add(`perform pg_temp.setcost(${sq(it.sku)}, 'Frete de aquisição', ${Math.round(it.freight * 100 * f)});`);
    } else {
      add(`perform pg_temp.setcost(${sq(it.sku)}, 'Mão de obra técnica (por hora)', ${Math.round(it.rate * 100 * f)});`);
    }
    add(`perform pg_temp.version(${sq(it.sku)}, ${days}, 'Reajuste de fornecedores / mão de obra');`);
    // parte dos itens reajusta preço no canal principal (o resto fica defasado: gera margens abaixo da meta)
    if (chance(0.55)) {
      const c = chans.get(it.sku)[0];
      let v = priceFor(it, c, f); if (v === last.get(`${it.sku}|${c}`)) v += 100; last.set(`${it.sku}|${c}`, v); add(`perform pg_temp.price(${sq(it.sku)}, ${sq(c)}, ${v}, ${days - 3}, 'Reajuste após revisão de custos');`);
    }
  }
}
// casos de demonstração: custo da webcam subiu e o preço ficou para trás (contribuição apertada); fone de ouvido virou prejuízo no marketplace Beta
add(`perform pg_temp.as_analyst();`);
add(`perform pg_temp.setcost('ELE-003', 'Compra do lote', ${Math.round(18.5 * 100 * 1.9) * 100});`);
add(`perform pg_temp.version('ELE-003', 5, 'Fornecedor reajustou fortemente');`);
add(`perform pg_temp.setcost('PAP-005', 'Compra do lote', ${Math.round(22.4 * 100 * 1.55) * 100});`);
add(`perform pg_temp.version('PAP-005', 4, 'Aumento do papel');`);

// listas de preço: tabela da loja publicada (v1), revisão v2 aguardando aprovação; tabela B2B em rascunho
const listItems = (skus, ch, mult = 1) => JSON.stringify(skus.map((s) => { const it = items.find((x) => x.sku === s); return { sku: s, price_cents: Math.round(priceFor(it, ch, factor.get(s), 3) * mult / 10) * 10 }; }));
const CAS = items.filter((i) => i.sku.startsWith('CAS-') && i.sku !== 'CAS-099').map((i) => i.sku);
const B2BS = items.filter((i) => i.sku.startsWith('PAP-')).map((i) => i.sku);
add(`do $l$ declare pl uuid; v uuid; pl2 uuid; v2 uuid; items_ jsonb;
begin
  perform pg_temp.as_analyst();
  insert into public.price_lists (organization_id, name, description, channel_id, created_by) values (pg_temp.org(), 'Tabela Loja 2026', 'Preços de balcão da loja física.', pg_temp.chan('LOJA'), '${uid(U.analyst)}') returning id into pl;
  v := public.pr_create_list_version(pg_temp.org(), pl, current_date - 90, null, 'Tabela vigente');
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements(${sq(listItems(CAS, 'LOJA'))}::jsonb) e;
  perform public.pr_set_list_items(pg_temp.org(), v, items_);
  perform public.pr_submit_list_version(pg_temp.org(), v);
  perform pg_temp.as_manager();
  perform public.pr_review_list_version(pg_temp.org(), v, true, 'Tabela conferida.');
  perform public.pr_publish_list_version(pg_temp.org(), v);
  -- revisão v2 (reajuste de 4 %) aguardando aprovação do gestor
  perform pg_temp.as_analyst();
  v2 := public.pr_create_list_version(pg_temp.org(), pl, current_date + 10, null, 'Reajuste de 4 % a partir do próximo ciclo', v);
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements(${sq(listItems(CAS, 'LOJA', 1.04))}::jsonb) e;
  perform public.pr_set_list_items(pg_temp.org(), v2, items_);
  perform public.pr_submit_list_version(pg_temp.org(), v2);
  -- tabela B2B só em rascunho
  insert into public.price_lists (organization_id, name, description, channel_id, created_by) values (pg_temp.org(), 'Tabela B2B (papelaria)', 'Em montagem.', pg_temp.chan('B2B'), '${uid(U.analyst)}') returning id into pl2;
  v2 := public.pr_create_list_version(pg_temp.org(), pl2, current_date, null, 'Rascunho inicial');
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements(${sq(listItems(B2BS, 'B2B'))}::jsonb) e;
  perform public.pr_set_list_items(pg_temp.org(), v2, items_);
end $l$;`);

// solicitações em todos os estados (analista 2 propõe; gestor decide)
const cur = (sku, ch) => priceFor(items.find((x) => x.sku === sku), ch, factor.get(sku));
add(`do $r$ declare r uuid; begin
  perform pg_temp.as_analyst2();
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-001'), pg_temp.chan('LOJA'), ${cur('PAP-001', 'LOJA') + 300}, 'Reajuste sugerido após aumento do fornecedor', 'manual');
  update public.price_change_requests set requested_at = pg_temp.ts(2) where id = r;
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-002'), pg_temp.chan('LOJA'), ${cur('PAP-002', 'LOJA') + 500}, 'Alinhar com a concorrência local', 'manual');
  perform pg_temp.as_manager();
  perform public.pr_review_price_change(pg_temp.org(), r, false, 'Preço acima do praticado pelo mercado; reavaliar.');
  update public.price_change_requests set requested_at = pg_temp.ts(6), reviewed_at = pg_temp.ts(5) where id = r;
  perform pg_temp.as_analyst2();
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-003'), pg_temp.chan('LOJA'), ${cur('PAP-003', 'LOJA') + 200}, 'Teste de preço', 'manual');
  perform public.pr_cancel_price_change(pg_temp.org(), r);
  update public.price_change_requests set requested_at = pg_temp.ts(8), reviewed_at = pg_temp.ts(8) where id = r;
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-004'), pg_temp.chan('LOJA'), ${cur('PAP-004', 'LOJA') + 250}, 'Margem abaixo da meta após reajuste de custo', 'manual');
  perform pg_temp.as_manager();
  perform public.pr_review_price_change(pg_temp.org(), r, true, 'Aprovado; publicar no início do próximo ciclo.');
  update public.price_change_requests set requested_at = pg_temp.ts(3), reviewed_at = pg_temp.ts(2) where id = r;
  perform pg_temp.as_analyst2();
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('BRI-001'), pg_temp.chan('MKA'), ${cur('BRI-001', 'MKA') + 400}, 'Marketplace Alfa subiu a comissão', 'manual');
  update public.price_change_requests set requested_at = pg_temp.ts(1) where id = r;
  r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('BEL-002'), pg_temp.chan('SITE'), ${cur('BEL-002', 'SITE') + 300}, 'Ajuste de posicionamento no site', 'manual');
  update public.price_change_requests set requested_at = pg_temp.ts(1) where id = r;
end $r$;`);

// cenários (analista): atual, conservador (+8 % custos), meta de 35 %, promocional (−10 %), premium (+12 %)
const SC = ['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003'];
const scen = (name, desc, adj, disc, mult, target) => add(`perform public.pr_save_scenario(pg_temp.org(), null, ${sq(name)}, ${sq(desc)}, (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * ${mult})::bigint, 'cost_adjust_pct', ${adj}, 'discount_pct', ${disc}${target ? `, 'target_margin_pct', ${target}` : ''})) from unnest(array[${SC.map(sq).join(', ')}]) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');`);
add(`perform pg_temp.as_analyst();`);
scen('Cenário atual', 'Preços e custos vigentes.', 0, 0, 1, null);
scen('Conservador (+8 % nos custos)', 'E se os fornecedores reajustarem 8 %?', 8, 0, 1, null);
scen('Meta de margem de 35 %', 'Preços atuais comparados à meta de 35 %.', 0, 0, 1, 35);
scen('Promocional (−10 %)', 'Campanha de 10 % de desconto.', 0, 10, 1, null);
scen('Premium (+12 % no preço)', 'Reposicionamento de preço.', 0, 0, 1.12, null);

// vendas observadas (dados fictícios de demonstração): ~90 dias, itens com preço em canal
const obs = [];
let ref = 1000;
for (const it of items) {
  const cs = chans.get(it.sku);
  if (!cs || it.sku === 'CAS-099') continue;
  for (const c of cs) {
    const days = new Set();
    for (let k = 0; k < int(3, 9); k++) days.add(int(1, 90));
    for (const d of days) {
      const qty = int(1, it.type === 'service' ? 3 : 8);
      const price = Math.round(priceFor(it, c, factor.get(it.sku) * (0.9 + rnd() * 0.15)) / 10) * 10;
      const gross = price * qty;
      const disc = chance(0.3) ? Math.round(gross * (0.05 + rnd() * 0.05)) : 0;
      const fees = Math.round(((gross - disc) * (CHANNELS.find((x) => x.key === c).fees.filter((f) => f[2] === 'price').reduce((s, f) => s + f[3], 0) + (CHANNELS.find((x) => x.key === c).tax ? TAX_PCT : 0))) / 100 + fixedOf(c) * qty);
      obs.push(`(${sq(it.sku)}, ${sq(c)}, ${d}, ${qty}, ${gross}, ${disc}, ${fees}, ${sq(`PED-${++ref}`)})`);
    }
  }
}
add(`insert into public.sales_observations (organization_id, item_id, channel_id, source, external_reference, quantity_decimal, gross_revenue_cents, discounts_cents, fees_cents, observed_at)
  select pg_temp.org(), pg_temp.item(v.sku), pg_temp.chan(v.ch), 'import', v.ref, v.qty, v.gross, v.disc, v.fees, current_date - v.days from (values ${obs.join(',\n  ')}) as v(sku, ch, days, qty, gross, disc, fees, ref);`);

// rotinas de avisos já nascem das funções; religa os gatilhos de imutabilidade
add(`alter table public.cost_model_versions enable trigger append_cost_model_versions;`);
add(`alter table public.price_change_events enable trigger append_price_change_events;`);
add(`alter table public.price_change_requests enable trigger request_guard;`);

// ---------------------------------------------------------------------------- escrita
const ops = `
do $ops$
begin
  if not exists (select 1 from public.organizations where id = '${ORG}') or exists (select 1 from public.cost_model_versions where organization_id = '${ORG}') then return; end if;
${sql.map((s) => `  ${s.replace(/\n/g, '\n  ')}`).join('\n')}
end $ops$;
`;
mkdirSync(join(root, 'supabase'), { recursive: true });
writeFileSync(join(root, 'supabase', 'seed.sql'), `-- GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados fictícios de demonstração (local). Senha dos usuários @demo.exemplo: DemoLocal#2026.\n${helpers}${prelude}${ops}`);
const counts = { items: items.length, observations: obs.length, statements: sql.length };
writeFileSync(join(root, 'supabase', 'seed-plan.json'), JSON.stringify({
  org: ORG, users: { owner: 'dono@demo.exemplo', manager: 'gestor@demo.exemplo', analyst: 'analista@demo.exemplo', analyst2: 'analista2@demo.exemplo', viewer: 'consulta@demo.exemplo' }, password: 'DemoLocal#2026',
  channels: CHANNELS.map((c) => c.name), noCostSku: NO_COST.sku, unknownCostSku: UNKNOWN_COST.sku,
  checksum: createHash('sha256').update(sql.join('\n')).digest('hex').slice(0, 16), counts,
}, null, 2) + '\n');
console.log(`seed.sql gerado: ${counts.items} itens, ${counts.observations} vendas observadas, ${counts.statements} instruções.`);

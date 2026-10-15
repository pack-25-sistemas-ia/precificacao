-- GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados fictícios de demonstração (local). Senha dos usuários @demo.exemplo: DemoLocal#2026.

create function pg_temp.org() returns uuid language sql as $f$ select 'e8e8e8e8-0000-4000-8000-000000000001'::uuid $f$;
create function pg_temp.as_user(p_id text, p_aal text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'aal', p_aal, 'role', 'authenticated')::text, true) $f$;
create function pg_temp.as_owner() returns void language sql as $f$ select pg_temp.as_user('e8e8e8e8-0000-4000-8000-0000000000a1', 'aal2') $f$;
create function pg_temp.as_manager() returns void language sql as $f$ select pg_temp.as_user('e8e8e8e8-0000-4000-8000-0000000000a2', 'aal1') $f$;
create function pg_temp.as_analyst() returns void language sql as $f$ select pg_temp.as_user('e8e8e8e8-0000-4000-8000-0000000000a3', 'aal1') $f$;
create function pg_temp.as_analyst2() returns void language sql as $f$ select pg_temp.as_user('e8e8e8e8-0000-4000-8000-0000000000a5', 'aal1') $f$;
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

do $seed$
declare
  org uuid := 'e8e8e8e8-0000-4000-8000-000000000001';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('e8e8e8e8-0000-4000-8000-0000000000a1', 'dono@demo.exemplo', 'Helena Duarte'), ('e8e8e8e8-0000-4000-8000-0000000000a2', 'gestor@demo.exemplo', 'Rodrigo Albuquerque'),
    ('e8e8e8e8-0000-4000-8000-0000000000a3', 'analista@demo.exemplo', 'Camila Teixeira'), ('e8e8e8e8-0000-4000-8000-0000000000a4', 'consulta@demo.exemplo', 'Otávio Mendes'),
    ('e8e8e8e8-0000-4000-8000-0000000000a5', 'analista2@demo.exemplo', 'Priscila Nogueira')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Aurora Variedades e Serviços Ltda. (dados fictícios)', 'aurora');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Aurora Variedades e Serviços', '{"primary":"#0e7490"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'e8e8e8e8-0000-4000-8000-0000000000a1', 'owner'), (org, 'e8e8e8e8-0000-4000-8000-0000000000a2', 'manager'), (org, 'e8e8e8e8-0000-4000-8000-0000000000a3', 'member'), (org, 'e8e8e8e8-0000-4000-8000-0000000000a4', 'viewer'), (org, 'e8e8e8e8-0000-4000-8000-0000000000a5', 'member');
  -- gatilhos de imutabilidade desligados SÓ durante o seed (para levar o histórico ao passado); religados no fim
  alter table public.cost_model_versions disable trigger append_cost_model_versions;
  alter table public.price_change_events disable trigger append_price_change_events;
  alter table public.price_change_requests disable trigger request_guard;
  -- categorias
  insert into public.product_categories (organization_id, name) values (org, 'Eletrônicos'), (org, 'Casa e cozinha'), (org, 'Papelaria'), (org, 'Brinquedos'), (org, 'Beleza'), (org, 'Serviços');
  insert into public.product_categories (organization_id, parent_id, name) select org, p.id, 'Acessórios' from public.product_categories p where p.organization_id = org and p.name = 'Eletrônicos' and p.parent_id is null;
  insert into public.product_categories (organization_id, parent_id, name) select org, p.id, 'Utensílios' from public.product_categories p where p.organization_id = org and p.name = 'Casa e cozinha' and p.parent_id is null;
  insert into public.product_categories (organization_id, parent_id, name) select org, p.id, 'Escritório' from public.product_categories p where p.organization_id = org and p.name = 'Papelaria' and p.parent_id is null;
  insert into public.product_categories (organization_id, parent_id, name) select org, p.id, 'Educativos' from public.product_categories p where p.organization_id = org and p.name = 'Brinquedos' and p.parent_id is null;
  insert into public.product_categories (organization_id, parent_id, name) select org, p.id, 'Cuidados pessoais' from public.product_categories p where p.organization_id = org and p.name = 'Beleza' and p.parent_id is null;
  -- perfil tributário INFORMADO (fictício) e canais
  insert into public.tax_profiles (organization_id, name, description, configuration_json) values (org, 'Tributos informados pela contabilidade (fictício)', 'Parâmetros de demonstração; não representam nenhuma regra fiscal real.',
    '{"taxes":[{"name":"Tributo sobre vendas (demonstração)","rate_pct":4.5,"basis":"price","source":"Orientação FICTÍCIA da contabilidade — apenas para demonstração"}]}'::jsonb);
  insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, 'Loja física', 'physical_store', (select id from public.tax_profiles where organization_id = org limit 1));
  insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, 'Site próprio', 'own_site', (select id from public.tax_profiles where organization_id = org limit 1));
  insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, 'Marketplace Alfa', 'marketplace', null);
  insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, 'Marketplace Beta', 'marketplace', null);
  insert into public.sales_channels (organization_id, name, channel_type, tax_profile_id) values (org, 'Venda direta B2B', 'b2b_direct', (select id from public.tax_profiles where organization_id = org limit 1));
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Taxa de cartão', 'payment', 'price', 2.5, null, null, 10 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Loja física';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Gateway de pagamento', 'payment', 'price', 3.2, null, null, 10 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Site próprio';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Taxa fixa do gateway', 'transaction', 'fixed_unit', null, 39, null, 20 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Site próprio';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Comissão Alfa', 'commission', 'price', 14, null, null, 10 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Marketplace Alfa';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Tarifa fixa Alfa', 'transaction', 'fixed_unit', null, 600, null, 20 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Marketplace Alfa';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Pagamento Alfa', 'payment', 'price', 2, null, null, 30 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Marketplace Alfa';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Comissão Beta', 'commission', 'price', 18, null, 4000, 10 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Marketplace Beta';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Frete subsidiado Beta', 'shipping_subsidy', 'fixed_unit', null, 890, null, 20 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Marketplace Beta';
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, maximum_amount_cents, priority) select org, ch.id, 'Comissão do representante', 'commission', 'price', 5, null, null, 10 from public.sales_channels ch where ch.organization_id = org and ch.name = 'Venda direta B2B';
  -- itens (sem preço: o preço nasce pelo fluxo de aprovação)
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-001', 'Cabo USB-C 1 m', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-002', 'Carregador 20 W', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-003', 'Fone de ouvido com fio', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-004', 'Caixa de som portátil', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-005', 'Power bank 10000 mAh', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-006', 'Suporte veicular', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-007', 'Mouse sem fio', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-008', 'Teclado compacto', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-009', 'Hub USB 4 portas', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-010', 'Webcam HD', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-001', 'Jogo de facas 3 peças', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-002', 'Tábua de corte bambu', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-003', 'Panela antiaderente 24 cm', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-004', 'Garrafa térmica 1 L', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-005', 'Conjunto de potes 5 un.', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-006', 'Escorredor de louça', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-007', 'Pano de prato (kit 4)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-008', 'Lixeira com pedal 5 L', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-009', 'Organizador de gavetas', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-010', 'Frigideira 26 cm', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-001', 'Caderno 96 folhas', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-002', 'Caneta gel (cx 12)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-003', 'Agenda executiva', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-004', 'Pasta classificadora', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-005', 'Papel A4 500 folhas', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-006', 'Marcador de texto (cx 6)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-007', 'Grampeador', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'PAP-008', 'Bloco adesivo', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Escritório' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BRI-001', 'Quebra-cabeça 200 peças', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Educativos' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BRI-002', 'Jogo de memória', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Educativos' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BRI-003', 'Blocos de montar 100 pç', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Educativos' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BRI-004', 'Massinha (kit 12)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Educativos' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BRI-005', 'Dominó de madeira', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Educativos' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BEL-001', 'Shampoo 350 ml', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Cuidados pessoais' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BEL-002', 'Hidratante 200 ml', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Cuidados pessoais' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BEL-003', 'Protetor solar FPS 50', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Cuidados pessoais' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BEL-004', 'Kit de escovas', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Cuidados pessoais' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'BEL-005', 'Sabonete líquido 250 ml', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Cuidados pessoais' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-001', 'Instalação de ar-condicionado', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-002', 'Manutenção preventiva de computador', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-003', 'Montagem de móveis', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-004', 'Visita técnica residencial', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-005', 'Configuração de rede Wi-Fi', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-006', 'Instalação elétrica (ponto)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-007', 'Limpeza pós-obra (m²)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-008', 'Consultoria em organização de estoque', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-009', 'Treinamento de equipe (turma)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-010', 'Design de identidade visual', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-011', 'Pintura de ambiente (m²)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-012', 'Revisão contábil gerencial', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-013', 'Entrega expressa urbana', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-014', 'Reparo hidráulico', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'service', 'SRV-015', 'Suporte remoto mensal', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Serviços' and c.parent_id is null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'ELE-099', 'Produto recém-cadastrado (sem custo)', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Acessórios' and c.parent_id is not null;
  insert into public.pricing_items (organization_id, category_id, item_type, sku, name, unit, created_at) select org, c.id, 'product', 'CAS-099', 'Produto com custo em levantamento', 'un', now() - interval '200 days' from public.product_categories c where c.organization_id = org and c.name = 'Utensílios' and c.parent_id is not null;
  perform set_config('request.jwt.claims', '{"sub":"e8e8e8e8-0000-4000-8000-0000000000a1","aal":"aal2","role":"authenticated"}', true);
end $seed$;

do $ops$
begin
  if not exists (select 1 from public.organizations where id = 'e8e8e8e8-0000-4000-8000-000000000001') or exists (select 1 from public.cost_model_versions where organization_id = 'e8e8e8e8-0000-4000-8000-000000000001') then return; end if;
  perform pg_temp.as_analyst();
  perform pg_temp.comp('ELE-001', 'direct', 'acquisition', 'Compra do lote', 129000, 100, 1, null);
  perform pg_temp.comp('ELE-001', 'direct', 'packaging', 'Embalagem', 60, 1, 1, null);
  perform pg_temp.comp('ELE-001', 'direct', 'acquisition_freight', 'Frete de aquisição', 40, 1, 1, null);
  perform pg_temp.comp('ELE-001', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-002', 'direct', 'acquisition', 'Compra do lote', 349000, 100, 1, null);
  perform pg_temp.comp('ELE-002', 'direct', 'packaging', 'Embalagem', 120, 1, 1, null);
  perform pg_temp.comp('ELE-002', 'direct', 'acquisition_freight', 'Frete de aquisição', 90, 1, 1, null);
  perform pg_temp.comp('ELE-002', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-003', 'direct', 'acquisition', 'Compra do lote', 185000, 100, 1, null);
  perform pg_temp.comp('ELE-003', 'direct', 'packaging', 'Embalagem', 90, 1, 1, null);
  perform pg_temp.comp('ELE-003', 'direct', 'acquisition_freight', 'Frete de aquisição', 50, 1, 1, null);
  perform pg_temp.comp('ELE-004', 'direct', 'acquisition', 'Compra do lote', 790000, 100, 1, null);
  perform pg_temp.comp('ELE-004', 'direct', 'packaging', 'Embalagem', 350, 1, 1, null);
  perform pg_temp.comp('ELE-004', 'direct', 'acquisition_freight', 'Frete de aquisição', 210, 1, 1, null);
  perform pg_temp.comp('ELE-004', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-005', 'direct', 'acquisition', 'Compra do lote', 640000, 100, 1, null);
  perform pg_temp.comp('ELE-005', 'direct', 'packaging', 'Embalagem', 240, 1, 1, null);
  perform pg_temp.comp('ELE-005', 'direct', 'acquisition_freight', 'Frete de aquisição', 180, 1, 1, null);
  perform pg_temp.comp('ELE-005', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-006', 'direct', 'acquisition', 'Compra do lote', 215000, 100, 1, null);
  perform pg_temp.comp('ELE-006', 'direct', 'packaging', 'Embalagem', 110, 1, 1, null);
  perform pg_temp.comp('ELE-006', 'direct', 'acquisition_freight', 'Frete de aquisição', 70, 1, 1, null);
  perform pg_temp.comp('ELE-007', 'direct', 'acquisition', 'Compra do lote', 299000, 100, 1, null);
  perform pg_temp.comp('ELE-007', 'direct', 'packaging', 'Embalagem', 140, 1, 1, null);
  perform pg_temp.comp('ELE-007', 'direct', 'acquisition_freight', 'Frete de aquisição', 80, 1, 1, null);
  perform pg_temp.comp('ELE-007', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-008', 'direct', 'acquisition', 'Compra do lote', 499000, 100, 1, null);
  perform pg_temp.comp('ELE-008', 'direct', 'packaging', 'Embalagem', 220, 1, 1, null);
  perform pg_temp.comp('ELE-008', 'direct', 'acquisition_freight', 'Frete de aquisição', 120, 1, 1, null);
  perform pg_temp.comp('ELE-008', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('ELE-009', 'direct', 'acquisition', 'Compra do lote', 382000, 100, 1, null);
  perform pg_temp.comp('ELE-009', 'direct', 'packaging', 'Embalagem', 150, 1, 1, null);
  perform pg_temp.comp('ELE-009', 'direct', 'acquisition_freight', 'Frete de aquisição', 90, 1, 1, null);
  perform pg_temp.comp('ELE-010', 'direct', 'acquisition', 'Compra do lote', 890000, 100, 1, null);
  perform pg_temp.comp('ELE-010', 'direct', 'packaging', 'Embalagem', 320, 1, 1, null);
  perform pg_temp.comp('ELE-010', 'direct', 'acquisition_freight', 'Frete de aquisição', 220, 1, 1, null);
  perform pg_temp.comp('CAS-001', 'direct', 'acquisition', 'Compra do lote', 420000, 100, 1, null);
  perform pg_temp.comp('CAS-001', 'direct', 'packaging', 'Embalagem', 280, 1, 1, null);
  perform pg_temp.comp('CAS-001', 'direct', 'acquisition_freight', 'Frete de aquisição', 160, 1, 1, null);
  perform pg_temp.comp('CAS-001', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-002', 'direct', 'acquisition', 'Compra do lote', 285000, 100, 1, null);
  perform pg_temp.comp('CAS-002', 'direct', 'packaging', 'Embalagem', 210, 1, 1, null);
  perform pg_temp.comp('CAS-002', 'direct', 'acquisition_freight', 'Frete de aquisição', 140, 1, 1, null);
  perform pg_temp.comp('CAS-003', 'direct', 'acquisition', 'Compra do lote', 699000, 100, 1, null);
  perform pg_temp.comp('CAS-003', 'direct', 'packaging', 'Embalagem', 340, 1, 1, null);
  perform pg_temp.comp('CAS-003', 'direct', 'acquisition_freight', 'Frete de aquisição', 280, 1, 1, null);
  perform pg_temp.comp('CAS-003', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-004', 'direct', 'acquisition', 'Compra do lote', 470000, 100, 1, null);
  perform pg_temp.comp('CAS-004', 'direct', 'packaging', 'Embalagem', 250, 1, 1, null);
  perform pg_temp.comp('CAS-004', 'direct', 'acquisition_freight', 'Frete de aquisição', 190, 1, 1, null);
  perform pg_temp.comp('CAS-004', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-005', 'direct', 'acquisition', 'Compra do lote', 335000, 100, 1, null);
  perform pg_temp.comp('CAS-005', 'direct', 'packaging', 'Embalagem', 260, 1, 1, null);
  perform pg_temp.comp('CAS-005', 'direct', 'acquisition_freight', 'Frete de aquisição', 170, 1, 1, null);
  perform pg_temp.comp('CAS-006', 'direct', 'acquisition', 'Compra do lote', 368000, 100, 1, null);
  perform pg_temp.comp('CAS-006', 'direct', 'packaging', 'Embalagem', 310, 1, 1, null);
  perform pg_temp.comp('CAS-006', 'direct', 'acquisition_freight', 'Frete de aquisição', 220, 1, 1, null);
  perform pg_temp.comp('CAS-006', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-007', 'direct', 'acquisition', 'Compra do lote', 154000, 100, 1, null);
  perform pg_temp.comp('CAS-007', 'direct', 'packaging', 'Embalagem', 70, 1, 1, null);
  perform pg_temp.comp('CAS-007', 'direct', 'acquisition_freight', 'Frete de aquisição', 60, 1, 1, null);
  perform pg_temp.comp('CAS-007', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-008', 'direct', 'acquisition', 'Compra do lote', 249000, 100, 1, null);
  perform pg_temp.comp('CAS-008', 'direct', 'packaging', 'Embalagem', 200, 1, 1, null);
  perform pg_temp.comp('CAS-008', 'direct', 'acquisition_freight', 'Frete de aquisição', 150, 1, 1, null);
  perform pg_temp.comp('CAS-009', 'direct', 'acquisition', 'Compra do lote', 199000, 100, 1, null);
  perform pg_temp.comp('CAS-009', 'direct', 'packaging', 'Embalagem', 120, 1, 1, null);
  perform pg_temp.comp('CAS-009', 'direct', 'acquisition_freight', 'Frete de aquisição', 90, 1, 1, null);
  perform pg_temp.comp('CAS-009', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('CAS-010', 'direct', 'acquisition', 'Compra do lote', 540000, 100, 1, null);
  perform pg_temp.comp('CAS-010', 'direct', 'packaging', 'Embalagem', 290, 1, 1, null);
  perform pg_temp.comp('CAS-010', 'direct', 'acquisition_freight', 'Frete de aquisição', 230, 1, 1, null);
  perform pg_temp.comp('CAS-010', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('PAP-001', 'direct', 'acquisition', 'Compra do lote', 98000, 100, 1, null);
  perform pg_temp.comp('PAP-001', 'direct', 'packaging', 'Embalagem', 40, 1, 1, null);
  perform pg_temp.comp('PAP-001', 'direct', 'acquisition_freight', 'Frete de aquisição', 30, 1, 1, null);
  perform pg_temp.comp('PAP-001', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('PAP-002', 'direct', 'acquisition', 'Compra do lote', 175000, 100, 1, null);
  perform pg_temp.comp('PAP-002', 'direct', 'packaging', 'Embalagem', 80, 1, 1, null);
  perform pg_temp.comp('PAP-002', 'direct', 'acquisition_freight', 'Frete de aquisição', 40, 1, 1, null);
  perform pg_temp.comp('PAP-003', 'direct', 'acquisition', 'Compra do lote', 269000, 100, 1, null);
  perform pg_temp.comp('PAP-003', 'direct', 'packaging', 'Embalagem', 130, 1, 1, null);
  perform pg_temp.comp('PAP-003', 'direct', 'acquisition_freight', 'Frete de aquisição', 70, 1, 1, null);
  perform pg_temp.comp('PAP-004', 'direct', 'acquisition', 'Compra do lote', 64000, 100, 1, null);
  perform pg_temp.comp('PAP-004', 'direct', 'packaging', 'Embalagem', 30, 1, 1, null);
  perform pg_temp.comp('PAP-004', 'direct', 'acquisition_freight', 'Frete de aquisição', 20, 1, 1, null);
  perform pg_temp.comp('PAP-005', 'direct', 'acquisition', 'Compra do lote', 224000, 100, 1, null);
  perform pg_temp.comp('PAP-005', 'direct', 'packaging', 'Embalagem', 110, 1, 1, null);
  perform pg_temp.comp('PAP-005', 'direct', 'acquisition_freight', 'Frete de aquisição', 90, 1, 1, null);
  perform pg_temp.comp('PAP-006', 'direct', 'acquisition', 'Compra do lote', 112000, 100, 1, null);
  perform pg_temp.comp('PAP-006', 'direct', 'packaging', 'Embalagem', 50, 1, 1, null);
  perform pg_temp.comp('PAP-006', 'direct', 'acquisition_freight', 'Frete de aquisição', 30, 1, 1, null);
  perform pg_temp.comp('PAP-007', 'direct', 'acquisition', 'Compra do lote', 245000, 100, 1, null);
  perform pg_temp.comp('PAP-007', 'direct', 'packaging', 'Embalagem', 140, 1, 1, null);
  perform pg_temp.comp('PAP-007', 'direct', 'acquisition_freight', 'Frete de aquisição', 80, 1, 1, null);
  perform pg_temp.comp('PAP-007', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('PAP-008', 'direct', 'acquisition', 'Compra do lote', 59000, 100, 1, null);
  perform pg_temp.comp('PAP-008', 'direct', 'packaging', 'Embalagem', 20, 1, 1, null);
  perform pg_temp.comp('PAP-008', 'direct', 'acquisition_freight', 'Frete de aquisição', 20, 1, 1, null);
  perform pg_temp.comp('BRI-001', 'direct', 'acquisition', 'Compra do lote', 210000, 100, 1, null);
  perform pg_temp.comp('BRI-001', 'direct', 'packaging', 'Embalagem', 120, 1, 1, null);
  perform pg_temp.comp('BRI-001', 'direct', 'acquisition_freight', 'Frete de aquisição', 90, 1, 1, null);
  perform pg_temp.comp('BRI-001', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('BRI-002', 'direct', 'acquisition', 'Compra do lote', 149000, 100, 1, null);
  perform pg_temp.comp('BRI-002', 'direct', 'packaging', 'Embalagem', 80, 1, 1, null);
  perform pg_temp.comp('BRI-002', 'direct', 'acquisition_freight', 'Frete de aquisição', 50, 1, 1, null);
  perform pg_temp.comp('BRI-003', 'direct', 'acquisition', 'Compra do lote', 385000, 100, 1, null);
  perform pg_temp.comp('BRI-003', 'direct', 'packaging', 'Embalagem', 200, 1, 1, null);
  perform pg_temp.comp('BRI-003', 'direct', 'acquisition_freight', 'Frete de aquisição', 140, 1, 1, null);
  perform pg_temp.comp('BRI-003', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('BRI-004', 'direct', 'acquisition', 'Compra do lote', 128000, 100, 1, null);
  perform pg_temp.comp('BRI-004', 'direct', 'packaging', 'Embalagem', 60, 1, 1, null);
  perform pg_temp.comp('BRI-004', 'direct', 'acquisition_freight', 'Frete de aquisição', 40, 1, 1, null);
  perform pg_temp.comp('BRI-004', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('BRI-005', 'direct', 'acquisition', 'Compra do lote', 174000, 100, 1, null);
  perform pg_temp.comp('BRI-005', 'direct', 'packaging', 'Embalagem', 90, 1, 1, null);
  perform pg_temp.comp('BRI-005', 'direct', 'acquisition_freight', 'Frete de aquisição', 70, 1, 1, null);
  perform pg_temp.comp('BEL-001', 'direct', 'acquisition', 'Compra do lote', 119000, 100, 1, null);
  perform pg_temp.comp('BEL-001', 'direct', 'packaging', 'Embalagem', 50, 1, 1, null);
  perform pg_temp.comp('BEL-001', 'direct', 'acquisition_freight', 'Frete de aquisição', 50, 1, 1, null);
  perform pg_temp.comp('BEL-001', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('BEL-002', 'direct', 'acquisition', 'Compra do lote', 145000, 100, 1, null);
  perform pg_temp.comp('BEL-002', 'direct', 'packaging', 'Embalagem', 60, 1, 1, null);
  perform pg_temp.comp('BEL-002', 'direct', 'acquisition_freight', 'Frete de aquisição', 50, 1, 1, null);
  perform pg_temp.comp('BEL-003', 'direct', 'acquisition', 'Compra do lote', 319000, 100, 1, null);
  perform pg_temp.comp('BEL-003', 'direct', 'packaging', 'Embalagem', 90, 1, 1, null);
  perform pg_temp.comp('BEL-003', 'direct', 'acquisition_freight', 'Frete de aquisição', 70, 1, 1, null);
  perform pg_temp.comp('BEL-004', 'direct', 'acquisition', 'Compra do lote', 228000, 100, 1, null);
  perform pg_temp.comp('BEL-004', 'direct', 'packaging', 'Embalagem', 110, 1, 1, null);
  perform pg_temp.comp('BEL-004', 'direct', 'acquisition_freight', 'Frete de aquisição', 60, 1, 1, null);
  perform pg_temp.comp('BEL-004', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('BEL-005', 'direct', 'acquisition', 'Compra do lote', 89000, 100, 1, null);
  perform pg_temp.comp('BEL-005', 'direct', 'packaging', 'Embalagem', 40, 1, 1, null);
  perform pg_temp.comp('BEL-005', 'direct', 'acquisition_freight', 'Frete de aquisição', 40, 1, 1, null);
  perform pg_temp.comp('BEL-005', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.comp('SRV-001', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 5500, 1, 3.5, null);
  perform pg_temp.comp('SRV-001', 'direct', 'supply', 'Materiais e insumos', 4800, 1, 1, null);
  perform pg_temp.comp('SRV-001', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 3.5, 'hours');
  perform pg_temp.comp('SRV-002', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 4800, 1, 1.5, null);
  perform pg_temp.comp('SRV-002', 'direct', 'supply', 'Materiais e insumos', 600, 1, 1, null);
  perform pg_temp.comp('SRV-002', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 1.5, 'hours');
  perform pg_temp.comp('SRV-003', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 3800, 1, 2.5, null);
  perform pg_temp.comp('SRV-003', 'direct', 'supply', 'Materiais e insumos', 400, 1, 1, null);
  perform pg_temp.comp('SRV-003', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 2.5, 'hours');
  perform pg_temp.comp('SRV-004', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 5200, 1, 1, null);
  perform pg_temp.comp('SRV-004', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 1, 'hours');
  perform pg_temp.comp('SRV-005', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 5800, 1, 2, null);
  perform pg_temp.comp('SRV-005', 'direct', 'supply', 'Materiais e insumos', 1200, 1, 1, null);
  perform pg_temp.comp('SRV-005', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 2, 'hours');
  perform pg_temp.comp('SRV-006', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 6200, 1, 1.8, null);
  perform pg_temp.comp('SRV-006', 'direct', 'supply', 'Materiais e insumos', 2200, 1, 1, null);
  perform pg_temp.comp('SRV-006', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 1.8, 'hours');
  perform pg_temp.comp('SRV-007', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 3400, 1, 0.25, null);
  perform pg_temp.comp('SRV-007', 'direct', 'supply', 'Materiais e insumos', 320, 1, 1, null);
  perform pg_temp.comp('SRV-007', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 0.25, 'hours');
  perform pg_temp.comp('SRV-008', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 9000, 1, 4, null);
  perform pg_temp.comp('SRV-008', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 4, 'hours');
  perform pg_temp.comp('SRV-009', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 8500, 1, 6, null);
  perform pg_temp.comp('SRV-009', 'direct', 'supply', 'Materiais e insumos', 2500, 1, 1, null);
  perform pg_temp.comp('SRV-009', 'direct', 'outsourced_service', 'Serviço terceirizado', 12000, 1, 1, null);
  perform pg_temp.comp('SRV-009', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 6, 'hours');
  perform pg_temp.comp('SRV-010', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 7000, 1, 12, null);
  perform pg_temp.comp('SRV-010', 'direct', 'outsourced_service', 'Serviço terceirizado', 15000, 1, 1, null);
  perform pg_temp.comp('SRV-010', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 12, 'hours');
  perform pg_temp.comp('SRV-011', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 3600, 1, 0.4, null);
  perform pg_temp.comp('SRV-011', 'direct', 'supply', 'Materiais e insumos', 950, 1, 1, null);
  perform pg_temp.comp('SRV-011', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 0.4, 'hours');
  perform pg_temp.comp('SRV-012', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 9500, 1, 3, null);
  perform pg_temp.comp('SRV-012', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 3, 'hours');
  perform pg_temp.comp('SRV-013', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 3200, 1, 0.8, null);
  perform pg_temp.comp('SRV-013', 'direct', 'supply', 'Materiais e insumos', 250, 1, 1, null);
  perform pg_temp.comp('SRV-013', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 0.8, 'hours');
  perform pg_temp.comp('SRV-014', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 5400, 1, 1.5, null);
  perform pg_temp.comp('SRV-014', 'direct', 'supply', 'Materiais e insumos', 1400, 1, 1, null);
  perform pg_temp.comp('SRV-014', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 1.5, 'hours');
  perform pg_temp.comp('SRV-015', 'direct', 'direct_labor', 'Mão de obra técnica (por hora)', 6000, 1, 2, null);
  perform pg_temp.comp('SRV-015', 'overhead', 'allocated_overhead', 'Estrutura (rateio por horas)', 1200000, 480, 2, 'hours');
  perform pg_temp.comp('CAS-099', 'direct', 'acquisition', 'Compra do lote', 250000, 100, 1, null);
  perform pg_temp.comp('CAS-099', 'direct', 'packaging', 'Embalagem', 100, 1, 1, null);
  perform pg_temp.comp('CAS-099', 'direct', 'acquisition_freight', 'Frete de aquisição', null, 1, 1, null);
  perform pg_temp.comp('CAS-099', 'overhead', 'allocated_overhead', 'Estrutura (aluguel e administração)', 1200000, 1500, 1, 'volume');
  perform pg_temp.version('ELE-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-006', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-007', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-008', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-009', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('ELE-010', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-006', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-007', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-008', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-009', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('CAS-010', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-006', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-007', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('PAP-008', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BRI-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BRI-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BRI-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BRI-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BRI-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BEL-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BEL-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BEL-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BEL-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('BEL-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-001', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-002', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-003', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-004', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-005', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-006', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-007', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-008', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-009', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-010', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-011', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-012', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-013', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-014', 175, 'Levantamento inicial de custos');
  perform pg_temp.version('SRV-015', 175, 'Levantamento inicial de custos');
  perform pg_temp.setcost('CAS-099', 'Frete de aquisição', 0);
  perform pg_temp.version('CAS-099', 175, 'Custo inicial (frete ainda não conhecido: zerado provisoriamente)');
  perform pg_temp.setcost('CAS-099', 'Frete de aquisição', null);
  perform pg_temp.comp('CAS-099', 'direct', 'other_direct', 'Taxa de importação (a confirmar)', null, 1, 1, null);
  perform pg_temp.as_manager();
  insert into public.pricing_policies (organization_id, name, description, target_margin_decimal, minimum_margin_decimal, max_discount_decimal, rounding_rule) values
    (pg_temp.org(), 'Padrão da empresa', 'Margem de contribuição padrão para tudo que não tem regra específica.', 30, 12, 15, 'up'),
    (pg_temp.org(), 'Marketplaces', 'Canais com comissão alta: meta menor, desconto máximo menor.', 24, 10, 8, 'charm_90'),
    (pg_temp.org(), 'Serviços', 'Serviços exigem margem maior por causa da capacidade ocupada.', 48, 30, 10, 'nearest'),
    (pg_temp.org(), 'Eletrônicos premium', 'Eletrônicos de maior valor.', 34, 20, 12, 'charm_90'),
    (pg_temp.org(), 'Exceção da webcam', 'Queima de estoque da webcam HD (item específico).', 20, 10, 20, 'up');
  perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Padrão da empresa'));
  perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Marketplaces'));
  perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Serviços'));
  perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Eletrônicos premium'));
  perform public.pr_publish_policy(pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Exceção da webcam'));
  insert into public.pricing_rule_assignments (organization_id, policy_id) values (pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Padrão da empresa'));
  insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id) values (pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Marketplaces'), pg_temp.chan('MKA')), (pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Marketplaces'), pg_temp.chan('MKB'));
  insert into public.pricing_rule_assignments (organization_id, policy_id, category_id) select pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Serviços'), id from public.product_categories where organization_id = pg_temp.org() and name = 'Serviços';
  insert into public.pricing_rule_assignments (organization_id, policy_id, category_id) select pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Eletrônicos premium'), id from public.product_categories where organization_id = pg_temp.org() and name = 'Acessórios' and parent_id is not null and exists (select 1 from public.product_categories p where p.id = parent_id and p.name = 'Eletrônicos');
  insert into public.pricing_rule_assignments (organization_id, policy_id, item_id) values (pg_temp.org(), (select id from public.pricing_policies where organization_id = pg_temp.org() and name = 'Exceção da webcam'), pg_temp.item('ELE-010'));
  perform pg_temp.price('ELE-001', null, 2390, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-001', 'LOJA', 2290, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-001', 'SITE', 2290, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-001', 'MKA', 3690, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-001', 'MKB', 4390, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-002', null, 5990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-002', 'LOJA', 5890, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-002', 'SITE', 6090, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-003', null, 3290, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-003', 'LOJA', 3190, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-003', 'MKA', 4790, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-003', 'MKB', 5590, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-004', null, 13590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-004', 'LOJA', 13490, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-004', 'SITE', 13690, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-005', null, 10990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-005', 'LOJA', 10890, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-005', 'SITE', 11090, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-006', null, 3790, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-006', 'LOJA', 3690, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-006', 'MKA', 5490, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-007', null, 5190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-007', 'LOJA', 5090, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-007', 'SITE', 5290, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-007', 'MKB', 7890, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-008', null, 8590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-008', 'LOJA', 8490, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-008', 'SITE', 8690, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-008', 'MKA', 10990, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-009', null, 6590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-009', 'LOJA', 6490, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-009', 'SITE', 6690, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-010', null, 15090, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('ELE-010', 'LOJA', 14990, 169, 'Preço inicial no canal');
  perform pg_temp.price('ELE-010', 'SITE', 15290, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-001', null, 7890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-001', 'LOJA', 7790, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-001', 'MKA', 10290, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-001', 'MKB', 11290, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-002', null, 5490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-002', 'LOJA', 5390, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-002', 'SITE', 5590, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-002', 'MKA', 7490, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-003', null, 12790, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-003', 'LOJA', 12690, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-003', 'SITE', 12890, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-003', 'MKA', 16090, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-004', null, 8690, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-004', 'LOJA', 8590, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-004', 'SITE', 8790, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-005', null, 6490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-005', 'LOJA', 6390, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-005', 'SITE', 6590, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-005', 'MKA', 8590, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-005', 'MKB', 9590, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-006', null, 7190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-006', 'LOJA', 7090, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-006', 'B2B', 7390, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-007', null, 2890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-007', 'LOJA', 2790, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-007', 'MKA', 4490, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-008', null, 4890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-008', 'LOJA', 4790, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-008', 'SITE', 4990, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-008', 'B2B', 4990, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-009', null, 3790, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-009', 'LOJA', 3690, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-009', 'MKB', 6390, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-010', null, 9990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-010', 'LOJA', 9890, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-010', 'SITE', 10090, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-001', null, 2090, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-001', 'LOJA', 1990, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-001', 'SITE', 2190, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-002', null, 3590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-002', 'LOJA', 3490, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-002', 'SITE', 3690, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-003', null, 5390, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-003', 'LOJA', 5290, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-003', 'SITE', 5490, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-004', null, 1390, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-004', 'LOJA', 1290, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-004', 'MKB', 3590, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-004', 'B2B', 1490, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-005', null, 4590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-005', 'LOJA', 4490, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-005', 'MKA', 6690, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-005', 'MKB', 7590, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-006', null, 2290, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-006', 'LOJA', 2190, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-006', 'MKA', 3990, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-007', null, 4990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-007', 'LOJA', 4890, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-007', 'MKA', 7190, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-008', null, 1290, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('PAP-008', 'LOJA', 1190, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-008', 'SITE', 1390, 169, 'Preço inicial no canal');
  perform pg_temp.price('PAP-008', 'MKB', 3490, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-001', null, 4190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BRI-001', 'LOJA', 4090, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-001', 'MKA', 6090, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-001', 'MKB', 6990, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-001', 'B2B', 4290, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-002', null, 2990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BRI-002', 'LOJA', 2890, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-002', 'SITE', 3090, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-003', null, 7490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BRI-003', 'LOJA', 7390, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-003', 'MKA', 9990, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-003', 'B2B', 7690, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-004', null, 2590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BRI-004', 'LOJA', 2490, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-004', 'SITE', 2690, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-005', null, 3490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BRI-005', 'LOJA', 3390, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-005', 'SITE', 3590, 169, 'Preço inicial no canal');
  perform pg_temp.price('BRI-005', 'B2B', 3590, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-001', null, 2590, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BEL-001', 'LOJA', 2490, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-001', 'SITE', 2690, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-001', 'MKA', 4290, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-002', null, 3090, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BEL-002', 'LOJA', 2990, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-002', 'SITE', 3190, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-002', 'MKA', 4990, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-003', null, 6490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BEL-003', 'LOJA', 6390, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-003', 'B2B', 6690, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-004', null, 4790, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BEL-004', 'LOJA', 4690, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-004', 'SITE', 4890, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-005', null, 1990, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('BEL-005', 'LOJA', 1890, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-005', 'SITE', 2090, 169, 'Preço inicial no canal');
  perform pg_temp.price('BEL-005', 'MKB', 4490, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-001', null, 56090, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-001', 'LOJA', 55990, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-002', null, 18290, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-002', 'LOJA', 18190, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-002', 'B2B', 19290, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-003', null, 23190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-003', 'LOJA', 23090, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-003', 'B2B', 24490, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-004', null, 12190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-004', 'LOJA', 12090, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-004', 'B2B', 12890, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-005', null, 29890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-005', 'LOJA', 29790, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-006', null, 31190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-006', 'LOJA', 31090, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-007', null, 2890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-007', 'LOJA', 2790, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-007', 'B2B', 2990, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-008', null, 83890, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-008', 'LOJA', 83790, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-008', 'B2B', 88890, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-009', null, 152490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-009', 'LOJA', 152390, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-009', 'B2B', 161790, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-010', null, 230390, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-010', 'LOJA', 230290, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-010', 'B2B', 244490, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-011', null, 5690, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-011', 'LOJA', 5590, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-012', null, 66390, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-012', 'LOJA', 66290, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-013', null, 6690, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-013', 'LOJA', 6590, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-014', null, 22190, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-014', 'LOJA', 22090, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-014', 'B2B', 23490, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-015', null, 28090, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('SRV-015', 'LOJA', 27990, 169, 'Preço inicial no canal');
  perform pg_temp.price('SRV-015', 'B2B', 29690, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-099', null, 4490, 170, 'Preço inicial do catálogo');
  perform pg_temp.price('CAS-099', 'LOJA', 4390, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-099', 'MKA', 6290, 169, 'Preço inicial no canal');
  perform pg_temp.price('CAS-099', 'MKB', 7190, 169, 'Preço inicial no canal');
  perform pg_temp.as_analyst();
  perform pg_temp.setcost('ELE-001', 'Compra do lote', 137900);
  perform pg_temp.setcost('ELE-001', 'Frete de aquisição', 43);
  perform pg_temp.version('ELE-001', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-001', 'LOJA', 2390, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-002', 'Compra do lote', 366600);
  perform pg_temp.setcost('ELE-002', 'Frete de aquisição', 95);
  perform pg_temp.version('ELE-002', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-002', 'LOJA', 6190, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-006', 'Compra do lote', 219600);
  perform pg_temp.setcost('ELE-006', 'Frete de aquisição', 72);
  perform pg_temp.version('ELE-006', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-009', 'Compra do lote', 389300);
  perform pg_temp.setcost('ELE-009', 'Frete de aquisição', 92);
  perform pg_temp.version('ELE-009', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-009', 'LOJA', 6590, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-010', 'Compra do lote', 925900);
  perform pg_temp.setcost('ELE-010', 'Frete de aquisição', 229);
  perform pg_temp.version('ELE-010', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-005', 'Compra do lote', 348800);
  perform pg_temp.setcost('CAS-005', 'Frete de aquisição', 177);
  perform pg_temp.version('CAS-005', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-008', 'Compra do lote', 266500);
  perform pg_temp.setcost('CAS-008', 'Frete de aquisição', 161);
  perform pg_temp.version('CAS-008', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-008', 'LOJA', 5090, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('CAS-009', 'Compra do lote', 213200);
  perform pg_temp.setcost('CAS-009', 'Frete de aquisição', 96);
  perform pg_temp.version('CAS-009', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-009', 'LOJA', 3990, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-002', 'Compra do lote', 180800);
  perform pg_temp.setcost('PAP-002', 'Frete de aquisição', 41);
  perform pg_temp.version('PAP-002', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-002', 'LOJA', 3590, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-007', 'Compra do lote', 254100);
  perform pg_temp.setcost('PAP-007', 'Frete de aquisição', 83);
  perform pg_temp.version('PAP-007', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BRI-005', 'Compra do lote', 179300);
  perform pg_temp.setcost('BRI-005', 'Frete de aquisição', 72);
  perform pg_temp.version('BRI-005', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-005', 'LOJA', 3490, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BEL-001', 'Compra do lote', 126400);
  perform pg_temp.setcost('BEL-001', 'Frete de aquisição', 53);
  perform pg_temp.version('BEL-001', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BEL-001', 'LOJA', 2590, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BEL-005', 'Compra do lote', 90000);
  perform pg_temp.setcost('BEL-005', 'Frete de aquisição', 40);
  perform pg_temp.version('BEL-005', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-001', 'Mão de obra técnica (por hora)', 5863);
  perform pg_temp.version('SRV-001', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-001', 'LOJA', 59690, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-004', 'Mão de obra técnica (por hora)', 5538);
  perform pg_temp.version('SRV-004', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-007', 'Mão de obra técnica (por hora)', 3576);
  perform pg_temp.version('SRV-007', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-007', 'LOJA', 2890, 117, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-008', 'Mão de obra técnica (por hora)', 9175);
  perform pg_temp.version('SRV-008', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-009', 'Mão de obra técnica (por hora)', 8688);
  perform pg_temp.version('SRV-009', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-011', 'Mão de obra técnica (por hora)', 3841);
  perform pg_temp.version('SRV-011', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-012', 'Mão de obra técnica (por hora)', 9481);
  perform pg_temp.version('SRV-012', 120, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-012', 'LOJA', 66190, 117, 'Reajuste após revisão de custos');
  perform pg_temp.as_analyst();
  perform pg_temp.setcost('ELE-001', 'Compra do lote', 150200);
  perform pg_temp.setcost('ELE-001', 'Frete de aquisição', 47);
  perform pg_temp.version('ELE-001', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-001', 'LOJA', 2590, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-003', 'Compra do lote', 196800);
  perform pg_temp.setcost('ELE-003', 'Frete de aquisição', 53);
  perform pg_temp.version('ELE-003', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-004', 'Compra do lote', 802100);
  perform pg_temp.setcost('ELE-004', 'Frete de aquisição', 213);
  perform pg_temp.version('ELE-004', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-005', 'Compra do lote', 676600);
  perform pg_temp.setcost('ELE-005', 'Frete de aquisição', 190);
  perform pg_temp.version('ELE-005', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-007', 'Compra do lote', 327200);
  perform pg_temp.setcost('ELE-007', 'Frete de aquisição', 88);
  perform pg_temp.version('ELE-007', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-007', 'LOJA', 5590, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-009', 'Compra do lote', 420700);
  perform pg_temp.setcost('ELE-009', 'Frete de aquisição', 99);
  perform pg_temp.version('ELE-009', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-004', 'Compra do lote', 491400);
  perform pg_temp.setcost('CAS-004', 'Frete de aquisição', 199);
  perform pg_temp.version('CAS-004', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-004', 'LOJA', 8990, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('CAS-005', 'Compra do lote', 360600);
  perform pg_temp.setcost('CAS-005', 'Frete de aquisição', 183);
  perform pg_temp.version('CAS-005', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-007', 'Compra do lote', 159400);
  perform pg_temp.setcost('CAS-007', 'Frete de aquisição', 62);
  perform pg_temp.version('CAS-007', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-008', 'Compra do lote', 276800);
  perform pg_temp.setcost('CAS-008', 'Frete de aquisição', 167);
  perform pg_temp.version('CAS-008', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-009', 'Compra do lote', 222000);
  perform pg_temp.setcost('CAS-009', 'Frete de aquisição', 100);
  perform pg_temp.version('CAS-009', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-010', 'Compra do lote', 586700);
  perform pg_temp.setcost('CAS-010', 'Frete de aquisição', 250);
  perform pg_temp.version('CAS-010', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-010', 'LOJA', 10790, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-001', 'Compra do lote', 106000);
  perform pg_temp.setcost('PAP-001', 'Frete de aquisição', 32);
  perform pg_temp.version('PAP-001', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-001', 'LOJA', 2090, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-003', 'Compra do lote', 294600);
  perform pg_temp.setcost('PAP-003', 'Frete de aquisição', 77);
  perform pg_temp.version('PAP-003', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-003', 'LOJA', 5790, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-005', 'Compra do lote', 239900);
  perform pg_temp.setcost('PAP-005', 'Frete de aquisição', 96);
  perform pg_temp.version('PAP-005', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('PAP-006', 'Compra do lote', 119800);
  perform pg_temp.setcost('PAP-006', 'Frete de aquisição', 32);
  perform pg_temp.version('PAP-006', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BRI-002', 'Compra do lote', 159100);
  perform pg_temp.setcost('BRI-002', 'Frete de aquisição', 53);
  perform pg_temp.version('BRI-002', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-002', 'LOJA', 3090, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BRI-004', 'Compra do lote', 131200);
  perform pg_temp.setcost('BRI-004', 'Frete de aquisição', 41);
  perform pg_temp.version('BRI-004', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-004', 'LOJA', 2590, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-001', 'Mão de obra técnica (por hora)', 6187);
  perform pg_temp.version('SRV-001', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-009', 'Mão de obra técnica (por hora)', 8912);
  perform pg_temp.version('SRV-009', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-010', 'Mão de obra técnica (por hora)', 7438);
  perform pg_temp.version('SRV-010', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-010', 'LOJA', 244690, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-011', 'Mão de obra técnica (por hora)', 4121);
  perform pg_temp.version('SRV-011', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-011', 'LOJA', 6390, 72, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-015', 'Mão de obra técnica (por hora)', 6518);
  perform pg_temp.version('SRV-015', 75, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-015', 'LOJA', 30390, 72, 'Reajuste após revisão de custos');
  perform pg_temp.as_analyst();
  perform pg_temp.setcost('ELE-001', 'Compra do lote', 163900);
  perform pg_temp.setcost('ELE-001', 'Frete de aquisição', 51);
  perform pg_temp.version('ELE-001', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-004', 'Compra do lote', 895400);
  perform pg_temp.setcost('ELE-004', 'Frete de aquisição', 238);
  perform pg_temp.version('ELE-004', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-004', 'LOJA', 15290, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-005', 'Compra do lote', 748000);
  perform pg_temp.setcost('ELE-005', 'Frete de aquisição', 210);
  perform pg_temp.version('ELE-005', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-007', 'Compra do lote', 357200);
  perform pg_temp.setcost('ELE-007', 'Frete de aquisição', 96);
  perform pg_temp.version('ELE-007', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-007', 'LOJA', 6090, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('ELE-010', 'Compra do lote', 971400);
  perform pg_temp.setcost('ELE-010', 'Frete de aquisição', 240);
  perform pg_temp.version('ELE-010', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('ELE-010', 'LOJA', 16390, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('CAS-003', 'Compra do lote', 712700);
  perform pg_temp.setcost('CAS-003', 'Frete de aquisição', 285);
  perform pg_temp.version('CAS-003', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-003', 'LOJA', 12990, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('CAS-008', 'Compra do lote', 307200);
  perform pg_temp.setcost('CAS-008', 'Frete de aquisição', 185);
  perform pg_temp.version('CAS-008', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-009', 'Compra do lote', 234800);
  perform pg_temp.setcost('CAS-009', 'Frete de aquisição', 106);
  perform pg_temp.version('CAS-009', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('PAP-001', 'Compra do lote', 115900);
  perform pg_temp.setcost('PAP-001', 'Frete de aquisição', 35);
  perform pg_temp.version('PAP-001', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-001', 'LOJA', 2290, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-003', 'Compra do lote', 315900);
  perform pg_temp.setcost('PAP-003', 'Frete de aquisição', 82);
  perform pg_temp.version('PAP-003', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('PAP-004', 'Compra do lote', 66600);
  perform pg_temp.setcost('PAP-004', 'Frete de aquisição', 21);
  perform pg_temp.version('PAP-004', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-004', 'LOJA', 1390, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-006', 'Compra do lote', 125700);
  perform pg_temp.setcost('PAP-006', 'Frete de aquisição', 34);
  perform pg_temp.version('PAP-006', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-006', 'LOJA', 2490, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-007', 'Compra do lote', 270100);
  perform pg_temp.setcost('PAP-007', 'Frete de aquisição', 88);
  perform pg_temp.version('PAP-007', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BRI-001', 'Compra do lote', 234600);
  perform pg_temp.setcost('BRI-001', 'Frete de aquisição', 101);
  perform pg_temp.version('BRI-001', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-001', 'LOJA', 4590, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BRI-002', 'Compra do lote', 168000);
  perform pg_temp.setcost('BRI-002', 'Frete de aquisição', 56);
  perform pg_temp.version('BRI-002', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-002', 'LOJA', 3290, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BRI-003', 'Compra do lote', 400400);
  perform pg_temp.setcost('BRI-003', 'Frete de aquisição', 146);
  perform pg_temp.version('BRI-003', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BRI-004', 'Compra do lote', 137900);
  perform pg_temp.setcost('BRI-004', 'Frete de aquisição', 43);
  perform pg_temp.version('BRI-004', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-004', 'LOJA', 2690, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BEL-003', 'Compra do lote', 338800);
  perform pg_temp.setcost('BEL-003', 'Frete de aquisição', 74);
  perform pg_temp.version('BEL-003', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-005', 'Mão de obra técnica (por hora)', 6523);
  perform pg_temp.version('SRV-005', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-005', 'LOJA', 33490, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-007', 'Mão de obra técnica (por hora)', 4014);
  perform pg_temp.version('SRV-007', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-007', 'LOJA', 3290, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-008', 'Mão de obra técnica (por hora)', 9957);
  perform pg_temp.version('SRV-008', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-009', 'Mão de obra técnica (por hora)', 9428);
  perform pg_temp.version('SRV-009', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-009', 'LOJA', 168990, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-010', 'Mão de obra técnica (por hora)', 7625);
  perform pg_temp.version('SRV-010', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-010', 'LOJA', 250790, 27, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-011', 'Mão de obra técnica (por hora)', 4530);
  perform pg_temp.version('SRV-011', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-014', 'Mão de obra técnica (por hora)', 5962);
  perform pg_temp.version('SRV-014', 30, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-014', 'LOJA', 24390, 27, 'Reajuste após revisão de custos');
  perform pg_temp.as_analyst();
  perform pg_temp.setcost('ELE-002', 'Compra do lote', 394500);
  perform pg_temp.setcost('ELE-002', 'Frete de aquisição', 102);
  perform pg_temp.version('ELE-002', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-008', 'Compra do lote', 522100);
  perform pg_temp.setcost('ELE-008', 'Frete de aquisição', 126);
  perform pg_temp.version('ELE-008', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-009', 'Compra do lote', 445100);
  perform pg_temp.setcost('ELE-009', 'Frete de aquisição', 105);
  perform pg_temp.version('ELE-009', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('ELE-010', 'Compra do lote', 1020900);
  perform pg_temp.setcost('ELE-010', 'Frete de aquisição', 252);
  perform pg_temp.version('ELE-010', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-005', 'Compra do lote', 363500);
  perform pg_temp.setcost('CAS-005', 'Frete de aquisição', 184);
  perform pg_temp.version('CAS-005', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('CAS-005', 'LOJA', 6890, 5, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('CAS-007', 'Compra do lote', 177600);
  perform pg_temp.setcost('CAS-007', 'Frete de aquisição', 69);
  perform pg_temp.version('CAS-007', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('CAS-008', 'Compra do lote', 310800);
  perform pg_temp.setcost('CAS-008', 'Frete de aquisição', 187);
  perform pg_temp.version('CAS-008', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('PAP-002', 'Compra do lote', 197600);
  perform pg_temp.setcost('PAP-002', 'Frete de aquisição', 45);
  perform pg_temp.version('PAP-002', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('PAP-002', 'LOJA', 3890, 5, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('PAP-003', 'Compra do lote', 360000);
  perform pg_temp.setcost('PAP-003', 'Frete de aquisição', 94);
  perform pg_temp.version('PAP-003', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BRI-004', 'Compra do lote', 151300);
  perform pg_temp.setcost('BRI-004', 'Frete de aquisição', 47);
  perform pg_temp.version('BRI-004', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('BRI-004', 'LOJA', 2890, 5, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('BRI-005', 'Compra do lote', 191500);
  perform pg_temp.setcost('BRI-005', 'Frete de aquisição', 77);
  perform pg_temp.version('BRI-005', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('BEL-001', 'Compra do lote', 136400);
  perform pg_temp.setcost('BEL-001', 'Frete de aquisição', 57);
  perform pg_temp.version('BEL-001', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-005', 'Mão de obra técnica (por hora)', 6884);
  perform pg_temp.version('SRV-005', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.setcost('SRV-008', 'Mão de obra técnica (por hora)', 11270);
  perform pg_temp.version('SRV-008', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.price('SRV-008', 'LOJA', 104890, 5, 'Reajuste após revisão de custos');
  perform pg_temp.setcost('SRV-011', 'Mão de obra técnica (por hora)', 4740);
  perform pg_temp.version('SRV-011', 8, 'Reajuste de fornecedores / mão de obra');
  perform pg_temp.as_analyst();
  perform pg_temp.setcost('ELE-003', 'Compra do lote', 351500);
  perform pg_temp.version('ELE-003', 5, 'Fornecedor reajustou fortemente');
  perform pg_temp.setcost('PAP-005', 'Compra do lote', 347200);
  perform pg_temp.version('PAP-005', 4, 'Aumento do papel');
  do $l$ declare pl uuid; v uuid; pl2 uuid; v2 uuid; items_ jsonb;
  begin
    perform pg_temp.as_analyst();
    insert into public.price_lists (organization_id, name, description, channel_id, created_by) values (pg_temp.org(), 'Tabela Loja 2026', 'Preços de balcão da loja física.', pg_temp.chan('LOJA'), 'e8e8e8e8-0000-4000-8000-0000000000a3') returning id into pl;
    v := public.pr_create_list_version(pg_temp.org(), pl, current_date - 90, null, 'Tabela vigente');
    select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements('[{"sku":"CAS-001","price_cents":8190},{"sku":"CAS-002","price_cents":5690},{"sku":"CAS-003","price_cents":13690},{"sku":"CAS-004","price_cents":9490},{"sku":"CAS-005","price_cents":7190},{"sku":"CAS-006","price_cents":7390},{"sku":"CAS-007","price_cents":3390},{"sku":"CAS-008","price_cents":6290},{"sku":"CAS-009","price_cents":4590},{"sku":"CAS-010","price_cents":11290}]'::jsonb) e;
    perform public.pr_set_list_items(pg_temp.org(), v, items_);
    perform public.pr_submit_list_version(pg_temp.org(), v);
    perform pg_temp.as_manager();
    perform public.pr_review_list_version(pg_temp.org(), v, true, 'Tabela conferida.');
    perform public.pr_publish_list_version(pg_temp.org(), v);
    -- revisão v2 (reajuste de 4 %) aguardando aprovação do gestor
    perform pg_temp.as_analyst();
    v2 := public.pr_create_list_version(pg_temp.org(), pl, current_date + 10, null, 'Reajuste de 4 % a partir do próximo ciclo', v);
    select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements('[{"sku":"CAS-001","price_cents":8520},{"sku":"CAS-002","price_cents":5920},{"sku":"CAS-003","price_cents":14240},{"sku":"CAS-004","price_cents":9870},{"sku":"CAS-005","price_cents":7480},{"sku":"CAS-006","price_cents":7690},{"sku":"CAS-007","price_cents":3530},{"sku":"CAS-008","price_cents":6540},{"sku":"CAS-009","price_cents":4770},{"sku":"CAS-010","price_cents":11740}]'::jsonb) e;
    perform public.pr_set_list_items(pg_temp.org(), v2, items_);
    perform public.pr_submit_list_version(pg_temp.org(), v2);
    -- tabela B2B só em rascunho
    insert into public.price_lists (organization_id, name, description, channel_id, created_by) values (pg_temp.org(), 'Tabela B2B (papelaria)', 'Em montagem.', pg_temp.chan('B2B'), 'e8e8e8e8-0000-4000-8000-0000000000a3') returning id into pl2;
    v2 := public.pr_create_list_version(pg_temp.org(), pl2, current_date, null, 'Rascunho inicial');
    select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(e ->> 'sku'), 'price_cents', (e ->> 'price_cents')::bigint)) into items_ from jsonb_array_elements('[{"sku":"PAP-001","price_cents":2590},{"sku":"PAP-002","price_cents":4290},{"sku":"PAP-003","price_cents":7890},{"sku":"PAP-004","price_cents":1490},{"sku":"PAP-005","price_cents":5290},{"sku":"PAP-006","price_cents":2790},{"sku":"PAP-007","price_cents":5990},{"sku":"PAP-008","price_cents":1290}]'::jsonb) e;
    perform public.pr_set_list_items(pg_temp.org(), v2, items_);
  end $l$;
  do $r$ declare r uuid; begin
    perform pg_temp.as_analyst2();
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-001'), pg_temp.chan('LOJA'), 2590, 'Reajuste sugerido após aumento do fornecedor', 'manual');
    update public.price_change_requests set requested_at = pg_temp.ts(2) where id = r;
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-002'), pg_temp.chan('LOJA'), 4390, 'Alinhar com a concorrência local', 'manual');
    perform pg_temp.as_manager();
    perform public.pr_review_price_change(pg_temp.org(), r, false, 'Preço acima do praticado pelo mercado; reavaliar.');
    update public.price_change_requests set requested_at = pg_temp.ts(6), reviewed_at = pg_temp.ts(5) where id = r;
    perform pg_temp.as_analyst2();
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-003'), pg_temp.chan('LOJA'), 7290, 'Teste de preço', 'manual');
    perform public.pr_cancel_price_change(pg_temp.org(), r);
    update public.price_change_requests set requested_at = pg_temp.ts(8), reviewed_at = pg_temp.ts(8) where id = r;
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('PAP-004'), pg_temp.chan('LOJA'), 1640, 'Margem abaixo da meta após reajuste de custo', 'manual');
    perform pg_temp.as_manager();
    perform public.pr_review_price_change(pg_temp.org(), r, true, 'Aprovado; publicar no início do próximo ciclo.');
    update public.price_change_requests set requested_at = pg_temp.ts(3), reviewed_at = pg_temp.ts(2) where id = r;
    perform pg_temp.as_analyst2();
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('BRI-001'), pg_temp.chan('MKA'), 7090, 'Marketplace Alfa subiu a comissão', 'manual');
    update public.price_change_requests set requested_at = pg_temp.ts(1) where id = r;
    r := public.pr_request_price_change(pg_temp.org(), pg_temp.item('BEL-002'), pg_temp.chan('SITE'), 3390, 'Ajuste de posicionamento no site', 'manual');
    update public.price_change_requests set requested_at = pg_temp.ts(1) where id = r;
  end $r$;
  perform pg_temp.as_analyst();
  perform public.pr_save_scenario(pg_temp.org(), null, 'Cenário atual', 'Preços e custos vigentes.', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * 1)::bigint, 'cost_adjust_pct', 0, 'discount_pct', 0)) from unnest(array['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003']) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');
  perform public.pr_save_scenario(pg_temp.org(), null, 'Conservador (+8 % nos custos)', 'E se os fornecedores reajustarem 8 %?', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * 1)::bigint, 'cost_adjust_pct', 8, 'discount_pct', 0)) from unnest(array['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003']) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');
  perform public.pr_save_scenario(pg_temp.org(), null, 'Meta de margem de 35 %', 'Preços atuais comparados à meta de 35 %.', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * 1)::bigint, 'cost_adjust_pct', 0, 'discount_pct', 0, 'target_margin_pct', 35)) from unnest(array['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003']) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');
  perform public.pr_save_scenario(pg_temp.org(), null, 'Promocional (−10 %)', 'Campanha de 10 % de desconto.', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * 1)::bigint, 'cost_adjust_pct', 0, 'discount_pct', 10)) from unnest(array['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003']) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');
  perform public.pr_save_scenario(pg_temp.org(), null, 'Premium (+12 % no preço)', 'Reposicionamento de preço.', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item(s), 'channel_id', pg_temp.chan(c), 'price_cents', round(coalesce(p.price_cents, 0) * 1.12)::bigint, 'cost_adjust_pct', 0, 'discount_pct', 0)) from unnest(array['ELE-001', 'ELE-004', 'CAS-003', 'CAS-004', 'PAP-005', 'BRI-003']) s cross join (values ('LOJA'), ('MKA')) v(c) join public.item_channel_prices p on p.item_id = pg_temp.item(s) and p.channel_id = pg_temp.chan(c)), '1.0.0');
  insert into public.sales_observations (organization_id, item_id, channel_id, source, external_reference, quantity_decimal, gross_revenue_cents, discounts_cents, fees_cents, observed_at)
    select pg_temp.org(), pg_temp.item(v.sku), pg_temp.chan(v.ch), 'import', v.ref, v.qty, v.gross, v.disc, v.fees, current_date - v.days from (values ('ELE-001', 'LOJA', 16, 5, 14950, 0, 1047, 'PED-1001'),
    ('ELE-001', 'LOJA', 71, 7, 20930, 0, 1465, 'PED-1002'),
    ('ELE-001', 'LOJA', 31, 7, 19530, 1812, 1240, 'PED-1003'),
    ('ELE-001', 'LOJA', 24, 5, 13450, 920, 877, 'PED-1004'),
    ('ELE-001', 'SITE', 36, 4, 10760, 0, 985, 'PED-1005'),
    ('ELE-001', 'SITE', 82, 3, 9270, 0, 831, 'PED-1006'),
    ('ELE-001', 'SITE', 57, 8, 23120, 1462, 1980, 'PED-1007'),
    ('ELE-001', 'SITE', 75, 2, 5580, 0, 508, 'PED-1008'),
    ('ELE-001', 'SITE', 58, 4, 11160, 0, 1015, 'PED-1009'),
    ('ELE-001', 'MKA', 11, 1, 4490, 0, 1318, 'PED-1010'),
    ('ELE-001', 'MKA', 35, 4, 17160, 0, 5146, 'PED-1011'),
    ('ELE-001', 'MKA', 36, 7, 30030, 0, 9005, 'PED-1012'),
    ('ELE-001', 'MKA', 77, 5, 21450, 1128, 6252, 'PED-1013'),
    ('ELE-001', 'MKB', 48, 2, 10380, 0, 3648, 'PED-1014'),
    ('ELE-001', 'MKB', 62, 1, 4990, 0, 1788, 'PED-1015'),
    ('ELE-001', 'MKB', 40, 4, 19960, 1910, 6809, 'PED-1016'),
    ('ELE-001', 'MKB', 82, 3, 14970, 0, 5365, 'PED-1017'),
    ('ELE-001', 'MKB', 84, 4, 19160, 0, 7009, 'PED-1018'),
    ('ELE-002', 'LOJA', 70, 7, 47530, 0, 3327, 'PED-1019'),
    ('ELE-002', 'LOJA', 86, 1, 6790, 448, 444, 'PED-1020'),
    ('ELE-002', 'LOJA', 75, 4, 26760, 0, 1873, 'PED-1021'),
    ('ELE-002', 'LOJA', 80, 4, 27160, 0, 1901, 'PED-1022'),
    ('ELE-002', 'LOJA', 58, 1, 6790, 0, 475, 'PED-1023'),
    ('ELE-002', 'LOJA', 77, 5, 31950, 0, 2237, 'PED-1024'),
    ('ELE-002', 'LOJA', 55, 7, 47530, 2520, 3151, 'PED-1025'),
    ('ELE-002', 'SITE', 32, 3, 19470, 1321, 1514, 'PED-1026'),
    ('ELE-002', 'SITE', 89, 8, 50320, 0, 4187, 'PED-1027'),
    ('ELE-002', 'SITE', 2, 8, 55920, 0, 4618, 'PED-1028'),
    ('ELE-002', 'SITE', 14, 3, 19170, 0, 1593, 'PED-1029'),
    ('ELE-002', 'SITE', 27, 1, 6990, 0, 577, 'PED-1030'),
    ('ELE-003', 'LOJA', 22, 3, 9870, 0, 691, 'PED-1031'),
    ('ELE-003', 'LOJA', 65, 8, 25520, 0, 1786, 'PED-1032'),
    ('ELE-003', 'LOJA', 41, 7, 23030, 0, 1612, 'PED-1033'),
    ('ELE-003', 'LOJA', 75, 7, 24430, 0, 1710, 'PED-1034'),
    ('ELE-003', 'LOJA', 44, 8, 28720, 0, 2010, 'PED-1035'),
    ('ELE-003', 'MKA', 31, 4, 19960, 1596, 5338, 'PED-1036'),
    ('ELE-003', 'MKA', 45, 8, 41520, 0, 11443, 'PED-1037'),
    ('ELE-003', 'MKA', 36, 8, 39120, 0, 11059, 'PED-1038'),
    ('ELE-003', 'MKA', 48, 7, 33530, 0, 9565, 'PED-1039'),
    ('ELE-003', 'MKB', 68, 8, 43920, 0, 15026, 'PED-1040'),
    ('ELE-003', 'MKB', 15, 3, 16770, 1652, 5391, 'PED-1041'),
    ('ELE-003', 'MKB', 29, 8, 44720, 0, 15170, 'PED-1042'),
    ('ELE-004', 'LOJA', 43, 5, 72950, 3994, 4827, 'PED-1043'),
    ('ELE-004', 'LOJA', 77, 4, 60760, 0, 4253, 'PED-1044'),
    ('ELE-004', 'LOJA', 2, 5, 73950, 0, 5177, 'PED-1045'),
    ('ELE-004', 'SITE', 21, 2, 32180, 0, 2556, 'PED-1046'),
    ('ELE-004', 'SITE', 62, 4, 57960, 0, 4619, 'PED-1047'),
    ('ELE-004', 'SITE', 70, 2, 29580, 2182, 2188, 'PED-1048'),
    ('ELE-004', 'SITE', 12, 3, 46170, 0, 3672, 'PED-1049'),
    ('ELE-004', 'SITE', 45, 8, 111920, 0, 8930, 'PED-1050'),
    ('ELE-004', 'SITE', 87, 4, 58360, 0, 4650, 'PED-1051'),
    ('ELE-005', 'LOJA', 80, 1, 11490, 0, 804, 'PED-1052'),
    ('ELE-005', 'LOJA', 65, 7, 83930, 7791, 5330, 'PED-1053'),
    ('ELE-005', 'LOJA', 67, 7, 81130, 0, 5679, 'PED-1054'),
    ('ELE-005', 'LOJA', 40, 5, 59950, 3416, 3957, 'PED-1055'),
    ('ELE-005', 'SITE', 84, 1, 11690, 0, 939, 'PED-1056'),
    ('ELE-005', 'SITE', 27, 2, 25180, 0, 2017, 'PED-1057'),
    ('ELE-005', 'SITE', 79, 8, 99120, 5529, 7519, 'PED-1058'),
    ('ELE-005', 'SITE', 45, 3, 36570, 2067, 2774, 'PED-1059'),
    ('ELE-005', 'SITE', 76, 8, 94320, 9381, 6852, 'PED-1060'),
    ('ELE-005', 'SITE', 48, 7, 85330, 0, 6843, 'PED-1061'),
    ('ELE-006', 'LOJA', 83, 1, 3690, 0, 258, 'PED-1062'),
    ('ELE-006', 'LOJA', 10, 1, 3790, 242, 248, 'PED-1063'),
    ('ELE-006', 'LOJA', 56, 1, 3690, 271, 239, 'PED-1064'),
    ('ELE-006', 'LOJA', 90, 1, 3990, 0, 279, 'PED-1065'),
    ('ELE-006', 'LOJA', 54, 8, 31920, 0, 2234, 'PED-1066'),
    ('ELE-006', 'LOJA', 20, 5, 17950, 1265, 1168, 'PED-1067'),
    ('ELE-006', 'MKA', 84, 3, 15870, 0, 4339, 'PED-1068'),
    ('ELE-006', 'MKA', 24, 4, 22360, 0, 5978, 'PED-1069'),
    ('ELE-006', 'MKA', 79, 3, 15870, 0, 4339, 'PED-1070'),
    ('ELE-006', 'MKA', 70, 2, 10380, 0, 2861, 'PED-1071'),
    ('ELE-006', 'MKA', 43, 1, 5090, 0, 1414, 'PED-1072'),
    ('ELE-006', 'MKA', 63, 8, 41520, 0, 11443, 'PED-1073'),
    ('ELE-006', 'MKA', 25, 5, 25950, 1418, 6925, 'PED-1074'),
    ('ELE-006', 'MKA', 4, 4, 21160, 0, 5786, 'PED-1075'),
    ('ELE-007', 'LOJA', 69, 6, 34740, 0, 2432, 'PED-1076'),
    ('ELE-007', 'LOJA', 39, 8, 47120, 0, 3298, 'PED-1077'),
    ('ELE-007', 'LOJA', 63, 2, 12780, 1224, 809, 'PED-1078'),
    ('ELE-007', 'LOJA', 33, 6, 34140, 0, 2390, 'PED-1079'),
    ('ELE-007', 'SITE', 37, 5, 31950, 0, 2655, 'PED-1080'),
    ('ELE-007', 'SITE', 10, 5, 30950, 1610, 2454, 'PED-1081'),
    ('ELE-007', 'SITE', 54, 7, 43330, 0, 3609, 'PED-1082'),
    ('ELE-007', 'SITE', 17, 3, 19470, 0, 1616, 'PED-1083'),
    ('ELE-007', 'SITE', 53, 5, 28950, 0, 2424, 'PED-1084'),
    ('ELE-007', 'SITE', 71, 5, 30450, 0, 2540, 'PED-1085'),
    ('ELE-007', 'SITE', 49, 6, 38340, 0, 3186, 'PED-1086'),
    ('ELE-007', 'MKB', 10, 8, 67920, 4088, 18610, 'PED-1087'),
    ('ELE-007', 'MKB', 27, 6, 52140, 0, 14725, 'PED-1088'),
    ('ELE-007', 'MKB', 47, 6, 50340, 0, 14401, 'PED-1089'),
    ('ELE-007', 'MKB', 62, 4, 36360, 0, 10105, 'PED-1090'),
    ('ELE-007', 'MKB', 9, 5, 46950, 0, 12901, 'PED-1091'),
    ('ELE-008', 'LOJA', 19, 8, 65520, 0, 4586, 'PED-1092'),
    ('ELE-008', 'LOJA', 35, 1, 8690, 807, 552, 'PED-1093'),
    ('ELE-008', 'LOJA', 44, 2, 17580, 0, 1231, 'PED-1094'),
    ('ELE-008', 'SITE', 53, 7, 65030, 0, 5280, 'PED-1095'),
    ('ELE-008', 'SITE', 44, 8, 71920, 0, 5850, 'PED-1096'),
    ('ELE-008', 'SITE', 71, 4, 35160, 0, 2863, 'PED-1097'),
    ('ELE-008', 'SITE', 73, 4, 32760, 0, 2679, 'PED-1098'),
    ('ELE-008', 'SITE', 38, 4, 37560, 0, 3048, 'PED-1099'),
    ('ELE-008', 'SITE', 7, 1, 8490, 0, 693, 'PED-1100'),
    ('ELE-008', 'MKA', 48, 5, 57450, 3770, 11589, 'PED-1101'),
    ('ELE-008', 'MKA', 34, 7, 74830, 0, 16173, 'PED-1102'),
    ('ELE-008', 'MKA', 71, 2, 21980, 0, 4717, 'PED-1103'),
    ('ELE-008', 'MKA', 18, 5, 57450, 0, 12192, 'PED-1104'),
    ('ELE-008', 'MKA', 43, 4, 43960, 0, 9434, 'PED-1105'),
    ('ELE-009', 'LOJA', 48, 5, 34450, 2567, 2232, 'PED-1106'),
    ('ELE-009', 'LOJA', 32, 3, 20370, 1592, 1314, 'PED-1107'),
    ('ELE-009', 'LOJA', 25, 1, 7090, 0, 496, 'PED-1108'),
    ('ELE-009', 'LOJA', 23, 4, 28360, 0, 1985, 'PED-1109'),
    ('ELE-009', 'SITE', 36, 3, 23070, 0, 1893, 'PED-1110'),
    ('ELE-009', 'SITE', 63, 4, 30360, 1992, 2340, 'PED-1111'),
    ('ELE-009', 'SITE', 45, 7, 52430, 0, 4310, 'PED-1112'),
    ('ELE-009', 'SITE', 18, 3, 22770, 0, 1870, 'PED-1113'),
    ('ELE-009', 'SITE', 84, 3, 20970, 0, 1732, 'PED-1114'),
    ('ELE-009', 'SITE', 31, 1, 7090, 485, 548, 'PED-1115'),
    ('ELE-010', 'LOJA', 15, 4, 65960, 0, 4617, 'PED-1116'),
    ('ELE-010', 'LOJA', 77, 1, 17090, 0, 1196, 'PED-1117'),
    ('ELE-010', 'LOJA', 66, 4, 63960, 0, 4477, 'PED-1118'),
    ('ELE-010', 'LOJA', 65, 4, 71960, 0, 5037, 'PED-1119'),
    ('ELE-010', 'LOJA', 63, 7, 115430, 0, 8080, 'PED-1120'),
    ('ELE-010', 'SITE', 7, 7, 111230, 8444, 8188, 'PED-1121'),
    ('ELE-010', 'SITE', 55, 8, 128720, 9488, 9493, 'PED-1122'),
    ('ELE-010', 'SITE', 69, 1, 17390, 1597, 1255, 'PED-1123'),
    ('ELE-010', 'SITE', 42, 4, 68360, 0, 5420, 'PED-1124'),
    ('ELE-010', 'SITE', 36, 2, 34980, 2819, 2554, 'PED-1125'),
    ('ELE-010', 'SITE', 48, 8, 127120, 0, 10100, 'PED-1126'),
    ('CAS-001', 'LOJA', 25, 7, 49630, 0, 3474, 'PED-1127'),
    ('CAS-001', 'LOJA', 68, 4, 31560, 0, 2209, 'PED-1128'),
    ('CAS-001', 'LOJA', 2, 7, 57330, 0, 4013, 'PED-1129'),
    ('CAS-001', 'LOJA', 24, 2, 14380, 0, 1007, 'PED-1130'),
    ('CAS-001', 'LOJA', 86, 5, 40450, 0, 2832, 'PED-1131'),
    ('CAS-001', 'MKA', 54, 5, 52450, 0, 11392, 'PED-1132'),
    ('CAS-001', 'MKA', 7, 5, 50450, 0, 11072, 'PED-1133'),
    ('CAS-001', 'MKA', 76, 4, 41960, 0, 9114, 'PED-1134'),
    ('CAS-001', 'MKB', 3, 3, 32970, 1933, 8257, 'PED-1135'),
    ('CAS-001', 'MKB', 14, 3, 32070, 0, 8443, 'PED-1136'),
    ('CAS-001', 'MKB', 19, 6, 68340, 0, 17641, 'PED-1137'),
    ('CAS-001', 'MKB', 33, 3, 32370, 0, 8497, 'PED-1138'),
    ('CAS-001', 'MKB', 54, 3, 33870, 0, 8767, 'PED-1139'),
    ('CAS-002', 'LOJA', 83, 4, 20360, 0, 1425, 'PED-1140'),
    ('CAS-002', 'LOJA', 89, 8, 41520, 0, 2906, 'PED-1141'),
    ('CAS-002', 'LOJA', 24, 3, 16470, 1430, 1053, 'PED-1142'),
    ('CAS-002', 'LOJA', 38, 2, 10980, 0, 769, 'PED-1143'),
    ('CAS-002', 'LOJA', 53, 3, 15570, 0, 1090, 'PED-1144'),
    ('CAS-002', 'SITE', 47, 5, 24950, 0, 2116, 'PED-1145'),
    ('CAS-002', 'SITE', 69, 3, 14970, 0, 1270, 'PED-1146'),
    ('CAS-002', 'SITE', 12, 1, 5390, 353, 427, 'PED-1147'),
    ('CAS-002', 'SITE', 51, 1, 5790, 0, 485, 'PED-1148'),
    ('CAS-002', 'MKA', 41, 8, 59120, 0, 14259, 'PED-1149'),
    ('CAS-002', 'MKA', 13, 2, 14580, 0, 3533, 'PED-1150'),
    ('CAS-002', 'MKA', 58, 4, 30760, 0, 7322, 'PED-1151'),
    ('CAS-002', 'MKA', 80, 4, 27560, 1807, 6520, 'PED-1152'),
    ('CAS-002', 'MKA', 36, 4, 28760, 0, 7002, 'PED-1153'),
    ('CAS-002', 'MKA', 26, 8, 61520, 0, 14643, 'PED-1154'),
    ('CAS-002', 'MKA', 17, 6, 44940, 3516, 10228, 'PED-1155'),
    ('CAS-003', 'LOJA', 62, 3, 36270, 3534, 2292, 'PED-1156'),
    ('CAS-003', 'LOJA', 28, 1, 12390, 983, 798, 'PED-1157'),
    ('CAS-003', 'LOJA', 86, 6, 73740, 0, 5162, 'PED-1158'),
    ('CAS-003', 'LOJA', 17, 2, 25380, 1576, 1666, 'PED-1159'),
    ('CAS-003', 'LOJA', 43, 1, 12990, 1157, 828, 'PED-1160'),
    ('CAS-003', 'LOJA', 49, 7, 90230, 0, 6316, 'PED-1161'),
    ('CAS-003', 'LOJA', 14, 2, 26380, 1338, 1753, 'PED-1162'),
    ('CAS-003', 'SITE', 29, 3, 36570, 0, 2933, 'PED-1163'),
    ('CAS-003', 'SITE', 78, 1, 13590, 0, 1085, 'PED-1164'),
    ('CAS-003', 'SITE', 18, 7, 95130, 7697, 7005, 'PED-1165'),
    ('CAS-003', 'SITE', 84, 5, 62950, 0, 5042, 'PED-1166'),
    ('CAS-003', 'SITE', 32, 2, 26380, 0, 2109, 'PED-1167'),
    ('CAS-003', 'SITE', 88, 8, 104720, 0, 8375, 'PED-1168'),
    ('CAS-003', 'SITE', 57, 7, 83230, 0, 6682, 'PED-1169'),
    ('CAS-003', 'MKA', 68, 6, 91740, 0, 18278, 'PED-1170'),
    ('CAS-003', 'MKA', 86, 6, 99540, 5176, 18698, 'PED-1171'),
    ('CAS-003', 'MKA', 19, 6, 95340, 0, 18854, 'PED-1172'),
    ('CAS-003', 'MKA', 43, 7, 109830, 0, 21773, 'PED-1173'),
    ('CAS-003', 'MKA', 66, 8, 134320, 0, 26291, 'PED-1174'),
    ('CAS-003', 'MKA', 7, 2, 33380, 0, 6541, 'PED-1175'),
    ('CAS-004', 'LOJA', 16, 2, 16780, 0, 1175, 'PED-1176'),
    ('CAS-004', 'LOJA', 36, 7, 60830, 0, 4258, 'PED-1177'),
    ('CAS-004', 'LOJA', 71, 6, 55140, 4423, 3550, 'PED-1178'),
    ('CAS-004', 'LOJA', 44, 8, 66320, 0, 4642, 'PED-1179'),
    ('CAS-004', 'LOJA', 70, 5, 45950, 2343, 3052, 'PED-1180'),
    ('CAS-004', 'SITE', 74, 3, 26970, 0, 2194, 'PED-1181'),
    ('CAS-004', 'SITE', 37, 3, 26070, 0, 2124, 'PED-1182'),
    ('CAS-004', 'SITE', 16, 8, 66320, 0, 5419, 'PED-1183'),
    ('CAS-004', 'SITE', 27, 3, 28170, 0, 2286, 'PED-1184'),
    ('CAS-004', 'SITE', 35, 2, 17780, 1224, 1353, 'PED-1185'),
    ('CAS-004', 'SITE', 56, 6, 50340, 0, 4110, 'PED-1186'),
    ('CAS-004', 'SITE', 40, 4, 35960, 0, 2925, 'PED-1187'),
    ('CAS-005', 'LOJA', 88, 1, 6190, 362, 408, 'PED-1188'),
    ('CAS-005', 'LOJA', 35, 3, 20970, 0, 1468, 'PED-1189'),
    ('CAS-005', 'LOJA', 7, 2, 13180, 0, 923, 'PED-1190'),
    ('CAS-005', 'SITE', 8, 2, 13580, 1029, 1044, 'PED-1191'),
    ('CAS-005', 'SITE', 13, 7, 45430, 2569, 3573, 'PED-1192'),
    ('CAS-005', 'SITE', 69, 7, 50330, 0, 4148, 'PED-1193'),
    ('CAS-005', 'SITE', 36, 5, 32450, 0, 2694, 'PED-1194'),
    ('CAS-005', 'SITE', 33, 4, 25960, 0, 2155, 'PED-1195'),
    ('CAS-005', 'MKA', 59, 3, 26370, 2497, 5620, 'PED-1196'),
    ('CAS-005', 'MKA', 53, 1, 9090, 0, 2054, 'PED-1197'),
    ('CAS-005', 'MKA', 6, 2, 17780, 0, 4045, 'PED-1198'),
    ('CAS-005', 'MKA', 90, 2, 18380, 0, 4141, 'PED-1199'),
    ('CAS-005', 'MKA', 11, 1, 9090, 670, 1947, 'PED-1200'),
    ('CAS-005', 'MKA', 13, 4, 38360, 2694, 8107, 'PED-1201'),
    ('CAS-005', 'MKB', 20, 5, 52450, 0, 13891, 'PED-1202'),
    ('CAS-005', 'MKB', 62, 2, 19980, 1395, 5125, 'PED-1203'),
    ('CAS-005', 'MKB', 40, 4, 40760, 0, 10897, 'PED-1204'),
    ('CAS-005', 'MKB', 28, 8, 77520, 6123, 19971, 'PED-1205'),
    ('CAS-005', 'MKB', 65, 4, 41160, 0, 10969, 'PED-1206'),
    ('CAS-006', 'LOJA', 14, 1, 7090, 0, 496, 'PED-1207'),
    ('CAS-006', 'LOJA', 36, 3, 20670, 0, 1447, 'PED-1208'),
    ('CAS-006', 'LOJA', 37, 4, 25960, 1688, 1699, 'PED-1209'),
    ('CAS-006', 'LOJA', 50, 5, 33450, 2929, 2136, 'PED-1210'),
    ('CAS-006', 'B2B', 2, 1, 7390, 0, 702, 'PED-1211'),
    ('CAS-006', 'B2B', 46, 2, 14380, 1135, 1258, 'PED-1212'),
    ('CAS-006', 'B2B', 83, 4, 29160, 0, 2770, 'PED-1213'),
    ('CAS-006', 'B2B', 53, 3, 21870, 2110, 1877, 'PED-1214'),
    ('CAS-007', 'LOJA', 11, 3, 9870, 0, 691, 'PED-1215'),
    ('CAS-007', 'LOJA', 23, 3, 9570, 0, 670, 'PED-1216'),
    ('CAS-007', 'LOJA', 51, 1, 2990, 0, 209, 'PED-1217'),
    ('CAS-007', 'MKA', 20, 6, 28140, 0, 8102, 'PED-1218'),
    ('CAS-007', 'MKA', 33, 3, 15270, 0, 4243, 'PED-1219'),
    ('CAS-007', 'MKA', 21, 4, 20760, 0, 5722, 'PED-1220'),
    ('CAS-007', 'MKA', 24, 2, 9380, 482, 2624, 'PED-1221'),
    ('CAS-007', 'MKA', 52, 6, 29940, 0, 8390, 'PED-1222'),
    ('CAS-008', 'LOJA', 88, 8, 44720, 0, 3130, 'PED-1223'),
    ('CAS-008', 'LOJA', 50, 1, 5890, 434, 382, 'PED-1224'),
    ('CAS-008', 'LOJA', 1, 1, 5490, 0, 384, 'PED-1225'),
    ('CAS-008', 'LOJA', 22, 6, 33540, 0, 2348, 'PED-1226'),
    ('CAS-008', 'SITE', 68, 7, 38430, 0, 3232, 'PED-1227'),
    ('CAS-008', 'SITE', 50, 3, 16770, 0, 1408, 'PED-1228'),
    ('CAS-008', 'SITE', 19, 2, 11380, 962, 880, 'PED-1229'),
    ('CAS-008', 'SITE', 82, 4, 21960, 0, 1847, 'PED-1230'),
    ('CAS-008', 'SITE', 81, 4, 23160, 0, 1939, 'PED-1231'),
    ('CAS-008', 'B2B', 59, 3, 16770, 0, 1593, 'PED-1232'),
    ('CAS-008', 'B2B', 7, 3, 19470, 0, 1850, 'PED-1233'),
    ('CAS-008', 'B2B', 27, 8, 49520, 0, 4704, 'PED-1234'),
    ('CAS-008', 'B2B', 34, 4, 22760, 0, 2162, 'PED-1235'),
    ('CAS-008', 'B2B', 31, 4, 25160, 0, 2390, 'PED-1236'),
    ('CAS-009', 'LOJA', 34, 5, 19950, 0, 1397, 'PED-1237'),
    ('CAS-009', 'LOJA', 71, 3, 12570, 0, 880, 'PED-1238'),
    ('CAS-009', 'LOJA', 39, 7, 28630, 0, 2004, 'PED-1239'),
    ('CAS-009', 'LOJA', 80, 6, 24540, 1350, 1623, 'PED-1240'),
    ('CAS-009', 'LOJA', 84, 2, 8180, 0, 573, 'PED-1241'),
    ('CAS-009', 'MKB', 29, 4, 29560, 0, 8881, 'PED-1242'),
    ('CAS-009', 'MKB', 82, 7, 49630, 0, 15163, 'PED-1243'),
    ('CAS-009', 'MKB', 54, 7, 50330, 0, 15289, 'PED-1244'),
    ('CAS-009', 'MKB', 85, 6, 40140, 0, 12565, 'PED-1245'),
    ('CAS-009', 'MKB', 75, 8, 55920, 0, 17186, 'PED-1246'),
    ('CAS-010', 'LOJA', 14, 8, 87920, 5820, 5747, 'PED-1247'),
    ('CAS-010', 'LOJA', 30, 5, 49950, 2883, 3295, 'PED-1248'),
    ('CAS-010', 'LOJA', 3, 2, 19780, 1829, 1257, 'PED-1249'),
    ('CAS-010', 'LOJA', 87, 8, 87920, 4531, 5837, 'PED-1250'),
    ('CAS-010', 'LOJA', 18, 7, 70630, 0, 4944, 'PED-1251'),
    ('CAS-010', 'SITE', 12, 7, 72030, 0, 5819, 'PED-1252'),
    ('CAS-010', 'SITE', 79, 8, 85520, 0, 6897, 'PED-1253'),
    ('CAS-010', 'SITE', 65, 7, 76230, 7035, 5601, 'PED-1254'),
    ('CAS-010', 'SITE', 44, 5, 55450, 0, 4465, 'PED-1255'),
    ('PAP-001', 'LOJA', 22, 3, 7170, 0, 502, 'PED-1256'),
    ('PAP-001', 'LOJA', 8, 6, 13740, 0, 962, 'PED-1257'),
    ('PAP-001', 'LOJA', 29, 3, 6870, 0, 481, 'PED-1258'),
    ('PAP-001', 'LOJA', 11, 8, 18320, 1231, 1196, 'PED-1259'),
    ('PAP-001', 'SITE', 88, 2, 4980, 0, 461, 'PED-1260'),
    ('PAP-001', 'SITE', 5, 1, 2290, 197, 200, 'PED-1261'),
    ('PAP-001', 'SITE', 42, 6, 13740, 717, 1237, 'PED-1262'),
    ('PAP-002', 'LOJA', 83, 2, 7180, 0, 503, 'PED-1263'),
    ('PAP-002', 'LOJA', 48, 7, 27230, 1465, 1804, 'PED-1264'),
    ('PAP-002', 'LOJA', 71, 3, 11970, 644, 793, 'PED-1265'),
    ('PAP-002', 'LOJA', 88, 8, 28720, 0, 2010, 'PED-1266'),
    ('PAP-002', 'LOJA', 6, 7, 27230, 0, 1906, 'PED-1267'),
    ('PAP-002', 'LOJA', 23, 2, 7780, 453, 513, 'PED-1268'),
    ('PAP-002', 'LOJA', 53, 5, 18450, 1612, 1179, 'PED-1269'),
    ('PAP-002', 'SITE', 59, 3, 12570, 1068, 1003, 'PED-1270'),
    ('PAP-002', 'SITE', 7, 5, 18950, 0, 1654, 'PED-1271'),
    ('PAP-002', 'SITE', 69, 3, 12270, 882, 994, 'PED-1272'),
    ('PAP-003', 'LOJA', 74, 4, 28360, 0, 1985, 'PED-1273'),
    ('PAP-003', 'LOJA', 75, 1, 6390, 0, 447, 'PED-1274'),
    ('PAP-003', 'LOJA', 40, 2, 12980, 0, 909, 'PED-1275'),
    ('PAP-003', 'LOJA', 53, 2, 13780, 0, 965, 'PED-1276'),
    ('PAP-003', 'LOJA', 48, 3, 21270, 0, 1489, 'PED-1277'),
    ('PAP-003', 'LOJA', 21, 1, 6890, 0, 482, 'PED-1278'),
    ('PAP-003', 'SITE', 81, 8, 55920, 4741, 4253, 'PED-1279'),
    ('PAP-003', 'SITE', 80, 7, 47530, 3954, 3628, 'PED-1280'),
    ('PAP-003', 'SITE', 35, 2, 13580, 0, 1124, 'PED-1281'),
    ('PAP-004', 'LOJA', 60, 1, 1290, 0, 90, 'PED-1282'),
    ('PAP-004', 'LOJA', 13, 2, 2380, 0, 167, 'PED-1283'),
    ('PAP-004', 'LOJA', 84, 6, 7740, 0, 542, 'PED-1284'),
    ('PAP-004', 'LOJA', 22, 1, 1190, 77, 78, 'PED-1285'),
    ('PAP-004', 'LOJA', 70, 1, 1390, 0, 97, 'PED-1286'),
    ('PAP-004', 'LOJA', 16, 8, 10320, 768, 669, 'PED-1287'),
    ('PAP-004', 'MKB', 50, 6, 21540, 1843, 8885, 'PED-1288'),
    ('PAP-004', 'MKB', 22, 8, 28720, 0, 12290, 'PED-1289'),
    ('PAP-004', 'MKB', 54, 2, 7380, 0, 3108, 'PED-1290'),
    ('PAP-004', 'MKB', 17, 6, 22140, 0, 9325, 'PED-1291'),
    ('PAP-004', 'MKB', 90, 7, 25130, 0, 10753, 'PED-1292'),
    ('PAP-004', 'MKB', 11, 6, 22740, 0, 9433, 'PED-1293'),
    ('PAP-004', 'B2B', 26, 3, 4470, 337, 393, 'PED-1294'),
    ('PAP-004', 'B2B', 14, 2, 2780, 0, 264, 'PED-1295'),
    ('PAP-004', 'B2B', 70, 1, 1390, 107, 122, 'PED-1296'),
    ('PAP-004', 'B2B', 11, 8, 11120, 0, 1056, 'PED-1297'),
    ('PAP-005', 'LOJA', 86, 1, 4890, 0, 342, 'PED-1298'),
    ('PAP-005', 'LOJA', 77, 1, 4490, 0, 314, 'PED-1299'),
    ('PAP-005', 'LOJA', 31, 7, 34230, 0, 2396, 'PED-1300'),
    ('PAP-005', 'LOJA', 53, 7, 31430, 0, 2200, 'PED-1301'),
    ('PAP-005', 'LOJA', 13, 1, 4790, 0, 335, 'PED-1302'),
    ('PAP-005', 'LOJA', 73, 5, 23950, 0, 1677, 'PED-1303'),
    ('PAP-005', 'MKA', 62, 7, 49630, 0, 12141, 'PED-1304'),
    ('PAP-005', 'MKA', 34, 5, 32950, 0, 8272, 'PED-1305'),
    ('PAP-005', 'MKA', 49, 8, 51920, 0, 13107, 'PED-1306'),
    ('PAP-005', 'MKA', 10, 2, 14380, 984, 3343, 'PED-1307'),
    ('PAP-005', 'MKA', 76, 6, 38940, 0, 9830, 'PED-1308'),
    ('PAP-005', 'MKA', 53, 7, 47530, 0, 11805, 'PED-1309'),
    ('PAP-005', 'MKB', 4, 4, 32760, 0, 9457, 'PED-1310'),
    ('PAP-005', 'MKB', 82, 1, 8090, 0, 2346, 'PED-1311'),
    ('PAP-005', 'MKB', 68, 3, 24270, 0, 7039, 'PED-1312'),
    ('PAP-005', 'MKB', 46, 8, 59920, 0, 17906, 'PED-1313'),
    ('PAP-005', 'MKB', 38, 7, 53130, 3891, 15093, 'PED-1314'),
    ('PAP-006', 'LOJA', 10, 2, 4580, 0, 321, 'PED-1315'),
    ('PAP-006', 'LOJA', 26, 4, 9560, 703, 620, 'PED-1316'),
    ('PAP-006', 'LOJA', 51, 2, 5180, 0, 363, 'PED-1317'),
    ('PAP-006', 'LOJA', 9, 2, 4980, 0, 349, 'PED-1318'),
    ('PAP-006', 'LOJA', 11, 4, 10360, 0, 725, 'PED-1319'),
    ('PAP-006', 'MKA', 40, 2, 8380, 0, 2541, 'PED-1320'),
    ('PAP-006', 'MKA', 1, 1, 4290, 0, 1286, 'PED-1321'),
    ('PAP-006', 'MKA', 27, 4, 16360, 1398, 4794, 'PED-1322'),
    ('PAP-007', 'LOJA', 77, 5, 25450, 0, 1782, 'PED-1323'),
    ('PAP-007', 'LOJA', 68, 3, 17070, 0, 1195, 'PED-1324'),
    ('PAP-007', 'LOJA', 75, 4, 21960, 0, 1537, 'PED-1325'),
    ('PAP-007', 'LOJA', 33, 3, 16770, 0, 1174, 'PED-1326'),
    ('PAP-007', 'MKA', 76, 2, 14380, 1011, 3339, 'PED-1327'),
    ('PAP-007', 'MKA', 69, 4, 31960, 1611, 7256, 'PED-1328'),
    ('PAP-007', 'MKA', 33, 1, 7890, 0, 1862, 'PED-1329'),
    ('PAP-007', 'MKA', 29, 5, 38450, 3349, 8616, 'PED-1330'),
    ('PAP-007', 'MKA', 36, 8, 62320, 0, 14771, 'PED-1331'),
    ('PAP-008', 'LOJA', 51, 3, 3570, 0, 250, 'PED-1332'),
    ('PAP-008', 'LOJA', 31, 6, 6540, 385, 431, 'PED-1333'),
    ('PAP-008', 'LOJA', 76, 5, 5950, 0, 417, 'PED-1334'),
    ('PAP-008', 'LOJA', 77, 1, 1190, 0, 83, 'PED-1335'),
    ('PAP-008', 'LOJA', 26, 5, 5450, 0, 382, 'PED-1336'),
    ('PAP-008', 'LOJA', 40, 3, 3570, 244, 233, 'PED-1337'),
    ('PAP-008', 'SITE', 74, 7, 9030, 546, 926, 'PED-1338'),
    ('PAP-008', 'SITE', 9, 2, 2380, 0, 261, 'PED-1339'),
    ('PAP-008', 'SITE', 83, 6, 7140, 0, 784, 'PED-1340'),
    ('PAP-008', 'MKB', 9, 5, 16950, 0, 7501, 'PED-1341'),
    ('PAP-008', 'MKB', 69, 5, 16950, 1574, 7218, 'PED-1342'),
    ('PAP-008', 'MKB', 27, 8, 27120, 1673, 11700, 'PED-1343'),
    ('PAP-008', 'MKB', 4, 2, 6780, 0, 3000, 'PED-1344'),
    ('PAP-008', 'MKB', 56, 6, 20940, 0, 9109, 'PED-1345'),
    ('BRI-001', 'LOJA', 85, 5, 23950, 0, 1677, 'PED-1346'),
    ('BRI-001', 'LOJA', 72, 4, 17560, 1735, 1108, 'PED-1347'),
    ('BRI-001', 'LOJA', 50, 2, 9380, 0, 657, 'PED-1348'),
    ('BRI-001', 'LOJA', 84, 1, 4190, 280, 274, 'PED-1349'),
    ('BRI-001', 'LOJA', 55, 7, 32830, 1692, 2180, 'PED-1350'),
    ('BRI-001', 'MKA', 81, 1, 6890, 0, 1702, 'PED-1351'),
    ('BRI-001', 'MKA', 27, 6, 38940, 0, 9830, 'PED-1352'),
    ('BRI-001', 'MKA', 70, 4, 24760, 1764, 6079, 'PED-1353'),
    ('BRI-001', 'MKA', 85, 8, 51120, 0, 12979, 'PED-1354'),
    ('BRI-001', 'MKA', 59, 5, 30950, 0, 7952, 'PED-1355'),
    ('BRI-001', 'MKA', 86, 5, 34450, 0, 8512, 'PED-1356'),
    ('BRI-001', 'MKA', 15, 3, 19470, 0, 4915, 'PED-1357'),
    ('BRI-001', 'MKB', 10, 6, 46140, 0, 13645, 'PED-1358'),
    ('BRI-001', 'MKB', 78, 7, 50330, 0, 15289, 'PED-1359'),
    ('BRI-001', 'MKB', 57, 3, 22470, 1284, 6483, 'PED-1360'),
    ('BRI-001', 'MKB', 31, 2, 13980, 0, 4296, 'PED-1361'),
    ('BRI-001', 'MKB', 21, 5, 35450, 3114, 10270, 'PED-1362'),
    ('BRI-001', 'B2B', 37, 8, 39120, 0, 3716, 'PED-1363'),
    ('BRI-001', 'B2B', 42, 1, 4490, 0, 427, 'PED-1364'),
    ('BRI-001', 'B2B', 62, 8, 37520, 0, 3564, 'PED-1365'),
    ('BRI-001', 'B2B', 68, 3, 14370, 0, 1365, 'PED-1366'),
    ('BRI-001', 'B2B', 51, 2, 9580, 907, 824, 'PED-1367'),
    ('BRI-002', 'LOJA', 8, 6, 19140, 0, 1340, 'PED-1368'),
    ('BRI-002', 'LOJA', 51, 8, 27120, 2643, 1713, 'PED-1369'),
    ('BRI-002', 'LOJA', 46, 3, 9270, 0, 649, 'PED-1370'),
    ('BRI-002', 'SITE', 6, 7, 22330, 0, 1992, 'PED-1371'),
    ('BRI-002', 'SITE', 81, 2, 6380, 0, 569, 'PED-1372'),
    ('BRI-002', 'SITE', 55, 2, 6180, 353, 527, 'PED-1373'),
    ('BRI-002', 'SITE', 65, 8, 26320, 0, 2339, 'PED-1374'),
    ('BRI-002', 'SITE', 77, 8, 24720, 0, 2215, 'PED-1375'),
    ('BRI-003', 'LOJA', 66, 6, 44940, 2932, 2941, 'PED-1376'),
    ('BRI-003', 'LOJA', 74, 3, 21870, 2180, 1378, 'PED-1377'),
    ('BRI-003', 'LOJA', 75, 1, 7990, 696, 511, 'PED-1378'),
    ('BRI-003', 'LOJA', 21, 8, 57520, 0, 4026, 'PED-1379'),
    ('BRI-003', 'LOJA', 62, 7, 54530, 0, 3817, 'PED-1380'),
    ('BRI-003', 'MKA', 28, 8, 79120, 0, 17459, 'PED-1381'),
    ('BRI-003', 'MKA', 13, 5, 51950, 0, 11312, 'PED-1382'),
    ('BRI-003', 'MKA', 66, 5, 49950, 0, 10992, 'PED-1383'),
    ('BRI-003', 'B2B', 6, 2, 15180, 0, 1442, 'PED-1384'),
    ('BRI-003', 'B2B', 9, 4, 33160, 2060, 2955, 'PED-1385'),
    ('BRI-003', 'B2B', 1, 5, 36450, 0, 3463, 'PED-1386'),
    ('BRI-003', 'B2B', 46, 6, 49140, 0, 4668, 'PED-1387'),
    ('BRI-004', 'LOJA', 35, 5, 14450, 0, 1012, 'PED-1388'),
    ('BRI-004', 'LOJA', 88, 2, 5780, 0, 405, 'PED-1389'),
    ('BRI-004', 'LOJA', 16, 3, 8370, 0, 586, 'PED-1390'),
    ('BRI-004', 'LOJA', 80, 6, 17940, 1203, 1172, 'PED-1391'),
    ('BRI-004', 'SITE', 4, 6, 16740, 0, 1523, 'PED-1392'),
    ('BRI-004', 'SITE', 76, 6, 17940, 1632, 1490, 'PED-1393'),
    ('BRI-004', 'SITE', 51, 2, 5980, 542, 497, 'PED-1394'),
    ('BRI-004', 'SITE', 16, 5, 15450, 0, 1385, 'PED-1395'),
    ('BRI-004', 'SITE', 2, 6, 16740, 0, 1523, 'PED-1396'),
    ('BRI-005', 'LOJA', 53, 8, 31120, 0, 2178, 'PED-1397'),
    ('BRI-005', 'LOJA', 44, 3, 10470, 0, 733, 'PED-1398'),
    ('BRI-005', 'LOJA', 22, 4, 13560, 1355, 854, 'PED-1399'),
    ('BRI-005', 'LOJA', 70, 1, 3690, 0, 258, 'PED-1400'),
    ('BRI-005', 'LOJA', 72, 2, 7580, 406, 502, 'PED-1401'),
    ('BRI-005', 'LOJA', 78, 1, 3790, 0, 265, 'PED-1402'),
    ('BRI-005', 'LOJA', 36, 4, 13960, 0, 977, 'PED-1403'),
    ('BRI-005', 'SITE', 60, 2, 7780, 415, 645, 'PED-1404'),
    ('BRI-005', 'SITE', 23, 4, 15160, 0, 1323, 'PED-1405'),
    ('BRI-005', 'SITE', 24, 4, 14360, 897, 1193, 'PED-1406'),
    ('BRI-005', 'SITE', 43, 8, 27920, 1613, 2338, 'PED-1407'),
    ('BRI-005', 'SITE', 37, 5, 17450, 1007, 1461, 'PED-1408'),
    ('BRI-005', 'SITE', 6, 3, 11070, 0, 969, 'PED-1409'),
    ('BRI-005', 'SITE', 73, 2, 7780, 0, 677, 'PED-1410'),
    ('BRI-005', 'SITE', 88, 7, 24430, 1724, 2021, 'PED-1411'),
    ('BRI-005', 'SITE', 19, 1, 3790, 0, 331, 'PED-1412'),
    ('BRI-005', 'B2B', 4, 4, 14360, 0, 1364, 'PED-1413'),
    ('BRI-005', 'B2B', 84, 6, 23940, 0, 2274, 'PED-1414'),
    ('BRI-005', 'B2B', 24, 4, 15960, 931, 1428, 'PED-1415'),
    ('BEL-001', 'LOJA', 52, 8, 21520, 2108, 1359, 'PED-1416'),
    ('BEL-001', 'LOJA', 61, 6, 16140, 0, 1130, 'PED-1417'),
    ('BEL-001', 'LOJA', 32, 8, 20720, 1984, 1312, 'PED-1418'),
    ('BEL-001', 'LOJA', 27, 4, 11160, 740, 729, 'PED-1419'),
    ('BEL-001', 'SITE', 82, 6, 16740, 0, 1523, 'PED-1420'),
    ('BEL-001', 'SITE', 50, 2, 5980, 589, 493, 'PED-1421'),
    ('BEL-001', 'SITE', 81, 3, 8970, 639, 758, 'PED-1422'),
    ('BEL-001', 'SITE', 75, 4, 11960, 0, 1077, 'PED-1423'),
    ('BEL-001', 'SITE', 90, 1, 2790, 0, 254, 'PED-1424'),
    ('BEL-001', 'MKA', 54, 4, 19560, 1829, 5237, 'PED-1425'),
    ('BEL-001', 'MKA', 43, 4, 18760, 0, 5402, 'PED-1426'),
    ('BEL-001', 'MKA', 23, 6, 28740, 2095, 7863, 'PED-1427'),
    ('BEL-001', 'MKA', 72, 8, 39120, 3892, 10436, 'PED-1428'),
    ('BEL-001', 'MKA', 35, 6, 28140, 1443, 7872, 'PED-1429'),
    ('BEL-001', 'MKA', 46, 5, 23950, 1449, 6600, 'PED-1430'),
    ('BEL-002', 'LOJA', 29, 4, 12360, 0, 865, 'PED-1431'),
    ('BEL-002', 'LOJA', 30, 6, 17340, 0, 1214, 'PED-1432'),
    ('BEL-002', 'LOJA', 32, 2, 5380, 373, 350, 'PED-1433'),
    ('BEL-002', 'SITE', 41, 7, 20930, 0, 1885, 'PED-1434'),
    ('BEL-002', 'SITE', 32, 8, 23120, 0, 2092, 'PED-1435'),
    ('BEL-002', 'SITE', 10, 3, 8670, 0, 785, 'PED-1436'),
    ('BEL-002', 'SITE', 3, 6, 17340, 0, 1569, 'PED-1437'),
    ('BEL-002', 'SITE', 51, 6, 19140, 0, 1708, 'PED-1438'),
    ('BEL-002', 'SITE', 75, 5, 14450, 0, 1308, 'PED-1439'),
    ('BEL-002', 'MKA', 56, 7, 34930, 0, 9789, 'PED-1440'),
    ('BEL-002', 'MKA', 86, 4, 19960, 0, 5594, 'PED-1441'),
    ('BEL-002', 'MKA', 42, 3, 14070, 959, 3898, 'PED-1442'),
    ('BEL-002', 'MKA', 79, 8, 39120, 0, 11059, 'PED-1443'),
    ('BEL-002', 'MKA', 84, 6, 28140, 0, 8102, 'PED-1444'),
    ('BEL-003', 'LOJA', 27, 3, 20670, 1716, 1327, 'PED-1445'),
    ('BEL-003', 'LOJA', 86, 3, 20670, 0, 1447, 'PED-1446'),
    ('BEL-003', 'LOJA', 1, 4, 24360, 0, 1705, 'PED-1447'),
    ('BEL-003', 'LOJA', 10, 1, 6990, 0, 489, 'PED-1448'),
    ('BEL-003', 'LOJA', 73, 8, 51120, 3240, 3352, 'PED-1449'),
    ('BEL-003', 'B2B', 43, 6, 40740, 3554, 3533, 'PED-1450'),
    ('BEL-003', 'B2B', 57, 3, 20970, 1435, 1856, 'PED-1451'),
    ('BEL-003', 'B2B', 3, 4, 27560, 2025, 2426, 'PED-1452'),
    ('BEL-003', 'B2B', 5, 6, 42540, 0, 4041, 'PED-1453'),
    ('BEL-003', 'B2B', 72, 8, 58320, 0, 5540, 'PED-1454'),
    ('BEL-004', 'LOJA', 20, 2, 8780, 0, 615, 'PED-1455'),
    ('BEL-004', 'LOJA', 69, 3, 13170, 784, 867, 'PED-1456'),
    ('BEL-004', 'LOJA', 37, 4, 17560, 0, 1229, 'PED-1457'),
    ('BEL-004', 'LOJA', 89, 1, 4590, 0, 321, 'PED-1458'),
    ('BEL-004', 'SITE', 88, 1, 4990, 0, 423, 'PED-1459'),
    ('BEL-004', 'SITE', 59, 2, 8780, 0, 754, 'PED-1460'),
    ('BEL-004', 'SITE', 43, 7, 34930, 0, 2963, 'PED-1461'),
    ('BEL-004', 'SITE', 48, 1, 4490, 415, 353, 'PED-1462'),
    ('BEL-004', 'SITE', 82, 3, 14670, 763, 1188, 'PED-1463'),
    ('BEL-005', 'LOJA', 31, 2, 3580, 0, 251, 'PED-1464'),
    ('BEL-005', 'LOJA', 86, 5, 9450, 813, 605, 'PED-1465'),
    ('BEL-005', 'LOJA', 75, 7, 12530, 0, 877, 'PED-1466'),
    ('BEL-005', 'SITE', 41, 6, 11340, 984, 1031, 'PED-1467'),
    ('BEL-005', 'SITE', 64, 1, 1990, 148, 181, 'PED-1468'),
    ('BEL-005', 'SITE', 48, 3, 5970, 0, 577, 'PED-1469'),
    ('BEL-005', 'MKB', 1, 5, 21950, 0, 8401, 'PED-1470'),
    ('BEL-005', 'MKB', 50, 2, 9180, 0, 3432, 'PED-1471'),
    ('BEL-005', 'MKB', 14, 6, 26340, 0, 10081, 'PED-1472'),
    ('SRV-001', 'LOJA', 50, 2, 114580, 8981, 7392, 'PED-1473'),
    ('SRV-001', 'LOJA', 37, 2, 131580, 0, 9211, 'PED-1474'),
    ('SRV-001', 'LOJA', 43, 2, 119180, 10305, 7621, 'PED-1475'),
    ('SRV-002', 'LOJA', 35, 1, 16390, 945, 1081, 'PED-1476'),
    ('SRV-002', 'LOJA', 48, 1, 17490, 0, 1224, 'PED-1477'),
    ('SRV-002', 'LOJA', 52, 3, 50370, 0, 3526, 'PED-1478'),
    ('SRV-002', 'B2B', 31, 3, 59070, 0, 5612, 'PED-1479'),
    ('SRV-002', 'B2B', 80, 1, 17590, 0, 1671, 'PED-1480'),
    ('SRV-002', 'B2B', 30, 1, 20190, 0, 1918, 'PED-1481'),
    ('SRV-003', 'LOJA', 17, 1, 20890, 0, 1462, 'PED-1482'),
    ('SRV-003', 'LOJA', 82, 1, 23890, 0, 1672, 'PED-1483'),
    ('SRV-003', 'LOJA', 1, 1, 21090, 0, 1476, 'PED-1484'),
    ('SRV-003', 'LOJA', 12, 3, 66270, 0, 4639, 'PED-1485'),
    ('SRV-003', 'LOJA', 22, 1, 23490, 0, 1644, 'PED-1486'),
    ('SRV-003', 'B2B', 11, 1, 24990, 0, 2374, 'PED-1487'),
    ('SRV-003', 'B2B', 32, 1, 23090, 0, 2194, 'PED-1488'),
    ('SRV-003', 'B2B', 89, 2, 48780, 0, 4634, 'PED-1489'),
    ('SRV-004', 'LOJA', 31, 1, 12490, 0, 874, 'PED-1490'),
    ('SRV-004', 'LOJA', 22, 3, 38070, 0, 2665, 'PED-1491'),
    ('SRV-004', 'LOJA', 59, 1, 12990, 1094, 833, 'PED-1492'),
    ('SRV-004', 'B2B', 49, 1, 13290, 0, 1263, 'PED-1493'),
    ('SRV-004', 'B2B', 36, 2, 24780, 0, 2354, 'PED-1494'),
    ('SRV-004', 'B2B', 11, 3, 43170, 0, 4101, 'PED-1495'),
    ('SRV-004', 'B2B', 48, 3, 41370, 0, 3930, 'PED-1496'),
    ('SRV-004', 'B2B', 18, 2, 27580, 0, 2620, 'PED-1497'),
    ('SRV-004', 'B2B', 75, 2, 25580, 0, 2430, 'PED-1498'),
    ('SRV-004', 'B2B', 71, 1, 13790, 0, 1310, 'PED-1499'),
    ('SRV-005', 'LOJA', 10, 1, 33690, 0, 2358, 'PED-1500'),
    ('SRV-005', 'LOJA', 17, 1, 34090, 2488, 2212, 'PED-1501'),
    ('SRV-005', 'LOJA', 54, 1, 36190, 0, 2533, 'PED-1502'),
    ('SRV-005', 'LOJA', 8, 2, 64180, 0, 4493, 'PED-1503'),
    ('SRV-005', 'LOJA', 63, 2, 73180, 0, 5123, 'PED-1504'),
    ('SRV-005', 'LOJA', 72, 3, 98670, 8536, 6309, 'PED-1505'),
    ('SRV-005', 'LOJA', 19, 3, 106170, 8855, 6812, 'PED-1506'),
    ('SRV-005', 'LOJA', 12, 1, 32690, 1876, 2157, 'PED-1507'),
    ('SRV-006', 'LOJA', 6, 2, 58380, 0, 4087, 'PED-1508'),
    ('SRV-006', 'LOJA', 50, 2, 57780, 0, 4045, 'PED-1509'),
    ('SRV-006', 'LOJA', 33, 1, 28490, 0, 1994, 'PED-1510'),
    ('SRV-006', 'LOJA', 74, 1, 30890, 0, 2162, 'PED-1511'),
    ('SRV-006', 'LOJA', 7, 2, 60180, 4680, 3885, 'PED-1512'),
    ('SRV-006', 'LOJA', 87, 3, 88770, 0, 6214, 'PED-1513'),
    ('SRV-007', 'LOJA', 32, 1, 2990, 201, 195, 'PED-1514'),
    ('SRV-007', 'LOJA', 11, 1, 3390, 254, 220, 'PED-1515'),
    ('SRV-007', 'LOJA', 21, 2, 6180, 0, 433, 'PED-1516'),
    ('SRV-007', 'LOJA', 63, 1, 3290, 0, 230, 'PED-1517'),
    ('SRV-007', 'B2B', 8, 3, 9570, 0, 909, 'PED-1518'),
    ('SRV-007', 'B2B', 10, 2, 6980, 0, 663, 'PED-1519'),
    ('SRV-007', 'B2B', 82, 1, 3090, 0, 294, 'PED-1520'),
    ('SRV-007', 'B2B', 9, 1, 3290, 235, 290, 'PED-1521'),
    ('SRV-007', 'B2B', 63, 2, 6980, 401, 625, 'PED-1522'),
    ('SRV-007', 'B2B', 46, 3, 9270, 0, 881, 'PED-1523'),
    ('SRV-007', 'B2B', 68, 2, 6580, 0, 625, 'PED-1524'),
    ('SRV-008', 'LOJA', 4, 3, 310770, 19515, 20388, 'PED-1525'),
    ('SRV-008', 'LOJA', 78, 3, 307770, 0, 21544, 'PED-1526'),
    ('SRV-008', 'LOJA', 73, 3, 312870, 29367, 19845, 'PED-1527'),
    ('SRV-008', 'LOJA', 55, 2, 212980, 0, 14909, 'PED-1528'),
    ('SRV-008', 'B2B', 85, 3, 326370, 0, 31005, 'PED-1529'),
    ('SRV-008', 'B2B', 75, 2, 224180, 17196, 19663, 'PED-1530'),
    ('SRV-008', 'B2B', 60, 3, 307770, 0, 29238, 'PED-1531'),
    ('SRV-008', 'B2B', 25, 2, 225580, 0, 21430, 'PED-1532'),
    ('SRV-008', 'B2B', 86, 2, 203980, 0, 19378, 'PED-1533'),
    ('SRV-008', 'B2B', 9, 2, 213380, 0, 20271, 'PED-1534'),
    ('SRV-009', 'LOJA', 81, 3, 523470, 28185, 34670, 'PED-1535'),
    ('SRV-009', 'LOJA', 47, 2, 310580, 0, 21741, 'PED-1536'),
    ('SRV-009', 'LOJA', 72, 3, 499470, 0, 34963, 'PED-1537'),
    ('SRV-009', 'B2B', 51, 2, 329180, 0, 31272, 'PED-1538'),
    ('SRV-009', 'B2B', 42, 3, 543270, 0, 51611, 'PED-1539'),
    ('SRV-009', 'B2B', 8, 1, 179190, 0, 17023, 'PED-1540'),
    ('SRV-010', 'LOJA', 72, 3, 700770, 60053, 44850, 'PED-1541'),
    ('SRV-010', 'LOJA', 83, 1, 251090, 15743, 16474, 'PED-1542'),
    ('SRV-010', 'LOJA', 57, 1, 256490, 0, 17954, 'PED-1543'),
    ('SRV-010', 'LOJA', 65, 3, 769170, 0, 53842, 'PED-1544'),
    ('SRV-010', 'LOJA', 34, 3, 759570, 0, 53170, 'PED-1545'),
    ('SRV-010', 'B2B', 88, 2, 542180, 46115, 47126, 'PED-1546'),
    ('SRV-010', 'B2B', 86, 3, 832470, 61445, 73247, 'PED-1547'),
    ('SRV-010', 'B2B', 80, 1, 248290, 0, 23588, 'PED-1548'),
    ('SRV-010', 'B2B', 11, 2, 490980, 39074, 42931, 'PED-1549'),
    ('SRV-010', 'B2B', 54, 3, 815670, 0, 77489, 'PED-1550'),
    ('SRV-010', 'B2B', 17, 3, 770970, 0, 73242, 'PED-1551'),
    ('SRV-011', 'LOJA', 40, 1, 7190, 0, 503, 'PED-1552'),
    ('SRV-011', 'LOJA', 79, 1, 7090, 0, 496, 'PED-1553'),
    ('SRV-011', 'LOJA', 41, 3, 20670, 0, 1447, 'PED-1554'),
    ('SRV-012', 'LOJA', 63, 2, 135180, 9891, 8770, 'PED-1555'),
    ('SRV-012', 'LOJA', 19, 2, 124380, 0, 8707, 'PED-1556'),
    ('SRV-012', 'LOJA', 65, 3, 190170, 18331, 12029, 'PED-1557'),
    ('SRV-012', 'LOJA', 52, 2, 138380, 10741, 8935, 'PED-1558'),
    ('SRV-012', 'LOJA', 77, 1, 68490, 0, 4794, 'PED-1559'),
    ('SRV-012', 'LOJA', 21, 1, 65190, 0, 4563, 'PED-1560'),
    ('SRV-012', 'LOJA', 41, 1, 61990, 0, 4339, 'PED-1561'),
    ('SRV-013', 'LOJA', 6, 1, 5990, 0, 419, 'PED-1562'),
    ('SRV-013', 'LOJA', 56, 2, 11980, 0, 839, 'PED-1563'),
    ('SRV-013', 'LOJA', 36, 3, 20070, 0, 1405, 'PED-1564'),
    ('SRV-013', 'LOJA', 12, 1, 6890, 0, 482, 'PED-1565'),
    ('SRV-013', 'LOJA', 87, 2, 12380, 0, 867, 'PED-1566'),
    ('SRV-014', 'LOJA', 14, 1, 23690, 0, 1658, 'PED-1567'),
    ('SRV-014', 'LOJA', 86, 2, 46180, 3182, 3010, 'PED-1568'),
    ('SRV-014', 'LOJA', 59, 1, 23690, 0, 1658, 'PED-1569'),
    ('SRV-014', 'B2B', 17, 3, 71970, 0, 6837, 'PED-1570'),
    ('SRV-014', 'B2B', 32, 2, 48180, 4166, 4181, 'PED-1571'),
    ('SRV-014', 'B2B', 22, 2, 50380, 0, 4786, 'PED-1572'),
    ('SRV-014', 'B2B', 49, 3, 77070, 0, 7322, 'PED-1573'),
    ('SRV-015', 'LOJA', 26, 2, 59580, 0, 4171, 'PED-1574'),
    ('SRV-015', 'LOJA', 55, 3, 83370, 0, 5836, 'PED-1575'),
    ('SRV-015', 'LOJA', 14, 2, 62580, 4738, 4049, 'PED-1576'),
    ('SRV-015', 'B2B', 33, 3, 86970, 4768, 7809, 'PED-1577'),
    ('SRV-015', 'B2B', 41, 2, 62980, 4355, 5569, 'PED-1578'),
    ('SRV-015', 'B2B', 36, 1, 32290, 2376, 2842, 'PED-1579'),
    ('SRV-015', 'B2B', 8, 1, 31690, 0, 3011, 'PED-1580'),
    ('SRV-015', 'B2B', 12, 3, 96270, 8190, 8368, 'PED-1581')) as v(sku, ch, days, qty, gross, disc, fees, ref);
  alter table public.cost_model_versions enable trigger append_cost_model_versions;
  alter table public.price_change_events enable trigger append_price_change_events;
  alter table public.price_change_requests enable trigger request_guard;
end $ops$;

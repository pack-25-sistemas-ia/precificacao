-- Precificação Inteligente — ESQUEMA (parte 1): tabelas, helpers de papel, RLS, privilégios.
-- Dinheiro final em centavos (bigint); custos unitários em centavos com fração (numeric(24,6)); percentuais como % com 4 casas (numeric(9,4)).
-- Cadastros simples por RLS + privilégio por coluna; versões, aprovações, publicação, cenários e importação SÓ por função (docs/DATABASE.md).
-- Regra de embed do Core: tabela que referencia organization_members NÃO referencia organizations (PGRST201) — por isso created_by/requested_by são uuid sem FK.

begin;
set local check_function_bodies = off;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;  -- para as classes de operador gist_*_ops (restrições de exclusão)

create type public.pr_item_type as enum ('product', 'service');
create type public.pr_channel_type as enum ('physical_store', 'own_site', 'marketplace', 'b2b_direct', 'representative', 'other');
create type public.pr_cost_class as enum ('direct', 'overhead');
create type public.pr_cost_type as enum ('acquisition', 'raw_material', 'direct_labor', 'packaging', 'acquisition_freight', 'supply', 'outsourced_service', 'other_direct', 'allocated_overhead');
create type public.pr_alloc_method as enum ('volume', 'services', 'hours', 'percent', 'manual');
create type public.pr_fee_kind as enum ('commission', 'payment', 'platform', 'shipping_subsidy', 'transaction', 'tax', 'other');
create type public.pr_fee_basis as enum ('price', 'net_price', 'cost', 'fixed_unit', 'fixed_transaction');
create type public.pr_rounding as enum ('nearest', 'up', 'down', 'charm_90', 'charm_99');
create type public.pr_policy_status as enum ('draft', 'published', 'retired');
create type public.pr_request_status as enum ('draft', 'pending', 'approved', 'rejected', 'published', 'cancelled');
create type public.pr_list_status as enum ('draft', 'pending', 'approved', 'rejected', 'published', 'retired');

-- ======================================================================= helpers de autorização
-- Perfis: owner/admin = Administrador · manager = Gestor comercial · member = Analista de precificação · viewer = Consulta.
create function private.pr_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
create function private.pr_can_read(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.pr_role(org) is not null; $$;
create function private.pr_is_analyst(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.pr_role(org) in ('owner', 'admin', 'manager', 'member'), false); $$;
create function private.pr_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.pr_role(org) in ('owner', 'admin', 'manager'), false); $$;
create function private.pr_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.pr_role(org) in ('owner', 'admin'), false); $$;
do $$
declare f text;
begin
  foreach f in array array['private.pr_role(uuid)', 'private.pr_can_read(uuid)', 'private.pr_is_analyst(uuid)', 'private.pr_is_manager(uuid)', 'private.pr_is_admin(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= configurações por empresa
create table public.pr_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  default_target_margin_pct numeric(9,4) not null default 30 check (default_target_margin_pct >= 0 and default_target_margin_pct < 100),
  default_minimum_margin_pct numeric(9,4) not null default 10 check (default_minimum_margin_pct >= 0 and default_minimum_margin_pct < 100),
  default_rounding public.pr_rounding not null default 'nearest',
  price_review_days integer not null default 90 check (price_review_days between 7 and 730),
  near_minimum_margin_pp numeric(9,4) not null default 2 check (near_minimum_margin_pp between 0 and 20),
  segregation_of_duties boolean not null default true,
  updated_at timestamptz not null default now(),
  check (default_minimum_margin_pct <= default_target_margin_pct)
);

-- ======================================================================= cadastros
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (parent_id, organization_id) references public.product_categories (id, organization_id)
);
create unique index categories_name_uniq on public.product_categories (organization_id, lower(trim(name)), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.pricing_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  item_type public.pr_item_type not null,
  sku text not null check (sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (char_length(description) <= 1000),
  unit text not null default 'un' check (char_length(trim(unit)) between 1 and 12),
  current_base_price_cents bigint check (current_base_price_cents > 0 and current_base_price_cents <= 99999999999999),
  price_reviewed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (category_id, organization_id) references public.product_categories (id, organization_id)
);
create unique index items_sku_uniq on public.pricing_items (organization_id, lower(sku));
create index items_org_status on public.pricing_items (organization_id, status) where archived_at is null;

create table public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  channel_type public.pr_channel_type not null default 'other',
  description text check (char_length(description) <= 300),
  tax_profile_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index channels_name_uniq on public.sales_channels (organization_id, lower(trim(name)));

create table public.item_channel_prices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  channel_id uuid not null,
  price_cents bigint not null check (price_cents > 0 and price_cents <= 99999999999999),
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, channel_id),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id)
);

-- ======================================================================= custos
create table public.cost_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  cost_class public.pr_cost_class not null default 'direct',
  cost_type public.pr_cost_type not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- centavos (com fração); NULL = DESCONHECIDO (nunca zero presumido)
  amount_cents numeric(24,6) check (amount_cents >= 0 and amount_cents <= 99999999999999999),
  quantity numeric(18,6) not null default 1 check (quantity > 0),
  usage numeric(18,6) not null default 1 check (usage > 0),
  unit text check (char_length(unit) <= 12),
  allocation_method public.pr_alloc_method,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  check ((cost_class = 'direct' and allocation_method is null and cost_type <> 'allocated_overhead')
      or (cost_class = 'overhead' and allocation_method is not null and cost_type = 'allocated_overhead'))
);
create index cost_components_item on public.cost_components (item_id);

create table public.cost_model_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  version_number integer not null check (version_number > 0),
  snapshot_json jsonb not null,
  direct_unit_cost_cents numeric(24,6) not null check (direct_unit_cost_cents >= 0),
  allocated_overhead_unit_cents numeric(24,6) check (allocated_overhead_unit_cents >= 0),
  full_unit_cost_cents numeric(24,6) check (full_unit_cost_cents >= 0),
  note text check (char_length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (item_id, version_number),
  unique (id, organization_id),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id)
);

-- ======================================================================= taxas, tributos informados e políticas
create table public.channel_fee_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  fee_type public.pr_fee_kind not null,
  basis public.pr_fee_basis not null,
  rate_decimal numeric(9,4) check (rate_decimal >= 0 and rate_decimal <= 100),
  fixed_amount_cents numeric(20,4) check (fixed_amount_cents >= 0),
  minimum_amount_cents numeric(20,4) check (minimum_amount_cents >= 0),
  maximum_amount_cents numeric(20,4) check (maximum_amount_cents >= 0),
  priority integer not null default 100,
  active boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id),
  check ((basis in ('price', 'net_price', 'cost') and rate_decimal is not null and fixed_amount_cents is null)
      or (basis in ('fixed_unit', 'fixed_transaction') and fixed_amount_cents is not null and rate_decimal is null and minimum_amount_cents is null and maximum_amount_cents is null)),
  check (minimum_amount_cents is null or maximum_amount_cents is null or minimum_amount_cents <= maximum_amount_cents),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index fee_rules_channel on public.channel_fee_rules (channel_id) where active;

create table public.tax_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  configuration_json jsonb not null default '{"taxes": []}'::jsonb check (jsonb_typeof(configuration_json) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index tax_profiles_name_uniq on public.tax_profiles (organization_id, lower(trim(name)));
alter table public.sales_channels add foreign key (tax_profile_id, organization_id) references public.tax_profiles (id, organization_id);

create table public.pricing_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  target_margin_decimal numeric(9,4) not null check (target_margin_decimal >= 0 and target_margin_decimal < 100),
  minimum_margin_decimal numeric(9,4) not null check (minimum_margin_decimal >= 0 and minimum_margin_decimal < 100),
  max_discount_decimal numeric(9,4) check (max_discount_decimal >= 0 and max_discount_decimal < 100),
  rounding_rule public.pr_rounding not null default 'nearest',
  min_price_cents bigint check (min_price_cents >= 0),
  status public.pr_policy_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (minimum_margin_decimal <= target_margin_decimal)
);
create unique index policies_name_uniq on public.pricing_policies (organization_id, lower(trim(name)));

create table public.pricing_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null,
  version_number integer not null check (version_number > 0),
  rules_snapshot_json jsonb not null,
  published_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (policy_id, version_number),
  unique (id, organization_id),
  foreign key (policy_id, organization_id) references public.pricing_policies (id, organization_id)
);

create table public.pricing_rule_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null,
  category_id uuid,
  channel_id uuid,
  item_id uuid,
  priority integer not null default 0,
  valid_from date,
  valid_until date,
  scope_key text generated always as (coalesce(item_id::text, '-') || '|' || coalesce(category_id::text, '-') || '|' || coalesce(channel_id::text, '-')) stored,
  created_at timestamptz not null default now(),
  foreign key (policy_id, organization_id) references public.pricing_policies (id, organization_id),
  foreign key (category_id, organization_id) references public.product_categories (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  check (not (item_id is not null and category_id is not null)),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  -- conflito de precedência impedido no banco: mesma política não, QUALQUER duas atribuições no mesmo escopo e vigências sobrepostas
  exclude using gist (organization_id with =, scope_key with =, daterange(valid_from, valid_until, '[]') with &&)
);

-- ======================================================================= listas de preço (versionadas)
create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  channel_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  valid_from date,
  valid_until date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create unique index price_lists_name_uniq on public.price_lists (organization_id, lower(trim(name)));

create table public.price_list_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  price_list_id uuid not null,
  version_number integer not null check (version_number > 0),
  status public.pr_list_status not null default 'draft',
  valid_from date,
  valid_until date,
  note text check (char_length(note) <= 500),
  submitted_by uuid,
  reviewed_by uuid,
  review_note text check (char_length(review_note) <= 500),
  reviewed_at timestamptz,
  published_at timestamptz,
  published_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (price_list_id, version_number),
  unique (id, organization_id),
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  -- no máximo uma versão PUBLICADA vigente por intervalo de datas
  exclude using gist (price_list_id with =, daterange(valid_from, valid_until, '[]') with &&) where (status = 'published')
);

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  price_list_version_id uuid not null,
  pricing_item_id uuid not null,
  price_cents bigint not null check (price_cents > 0 and price_cents <= 99999999999999),
  minimum_quantity_decimal numeric(18,6) check (minimum_quantity_decimal >= 0),
  maximum_quantity_decimal numeric(18,6) check (maximum_quantity_decimal > 0),
  effective_from date,
  effective_until date,
  created_at timestamptz not null default now(),
  foreign key (price_list_version_id, organization_id) references public.price_list_versions (id, organization_id),
  foreign key (pricing_item_id, organization_id) references public.pricing_items (id, organization_id),
  check (maximum_quantity_decimal is null or minimum_quantity_decimal is null or maximum_quantity_decimal >= minimum_quantity_decimal),
  check (effective_until is null or effective_from is null or effective_until >= effective_from),
  exclude using gist (price_list_version_id with =, pricing_item_id with =, numrange(coalesce(minimum_quantity_decimal, 0), maximum_quantity_decimal, '[]') with &&)
);

-- ======================================================================= cenários (snapshots imutáveis)
create table public.pricing_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index scenarios_name_uniq on public.pricing_scenarios (organization_id, lower(trim(name)));

create table public.pricing_scenario_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null,
  version_number integer not null check (version_number > 0),
  input_snapshot_json jsonb not null,
  output_snapshot_json jsonb not null,
  engine_version text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (scenario_id, version_number),
  unique (id, organization_id),
  foreign key (scenario_id, organization_id) references public.pricing_scenarios (id, organization_id)
);

create table public.pricing_scenario_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_version_id uuid not null,
  pricing_item_id uuid not null,
  channel_id uuid not null,
  input_price_cents bigint not null check (input_price_cents > 0),
  suggested_price_cents bigint check (suggested_price_cents > 0),
  suggestion_verified boolean,
  direct_cost_cents bigint not null,
  fees_cents bigint not null,
  contribution_cents bigint not null,
  margin_decimal numeric(12,6),
  markup_decimal numeric(14,6),
  viable boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (scenario_version_id, organization_id) references public.pricing_scenario_versions (id, organization_id),
  foreign key (pricing_item_id, organization_id) references public.pricing_items (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id)
);
create index scenario_items_version on public.pricing_scenario_items (scenario_version_id);

-- ======================================================================= alterações de preço (aprovação) e histórico
create table public.price_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  channel_id uuid,
  previous_price_cents bigint check (previous_price_cents > 0),
  proposed_price_cents bigint not null check (proposed_price_cents > 0 and proposed_price_cents <= 99999999999999),
  justification text not null check (char_length(trim(justification)) between 5 and 500),
  impact_json jsonb not null default '{}'::jsonb,
  status public.pr_request_status not null default 'pending',
  source text not null default 'manual' check (source in ('manual', 'import', 'scenario')),
  requested_by uuid not null,
  reviewed_by uuid,
  review_note text check (char_length(review_note) <= 500),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  unique (id, organization_id),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id)
);
create index requests_org_status on public.price_change_requests (organization_id, status, requested_at desc);
-- no máximo uma solicitação em andamento por item × canal (evita aprovações concorrentes sobre o mesmo preço)
create unique index requests_open_uniq on public.price_change_requests (organization_id, item_id, coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('pending', 'approved');

create table public.price_change_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid,
  list_version_id uuid,
  item_id uuid not null,
  channel_id uuid,
  previous_price_cents bigint,
  new_price_cents bigint not null check (new_price_cents > 0),
  effective_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id),
  foreign key (request_id, organization_id) references public.price_change_requests (id, organization_id),
  foreign key (list_version_id, organization_id) references public.price_list_versions (id, organization_id)
);
create index price_events_item on public.price_change_events (item_id, effective_at desc);

-- ======================================================================= vendas observadas (opcional), importações, avisos
create table public.sales_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  channel_id uuid,
  source text not null default 'import' check (source in ('import', 'manual')),
  external_reference text check (char_length(external_reference) <= 80),
  quantity_decimal numeric(18,6) not null check (quantity_decimal > 0),
  gross_revenue_cents bigint not null check (gross_revenue_cents >= 0),
  discounts_cents bigint not null default 0 check (discounts_cents >= 0),
  fees_cents bigint not null default 0 check (fees_cents >= 0),
  observed_at date not null,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  foreign key (item_id, organization_id) references public.pricing_items (id, organization_id),
  foreign key (channel_id, organization_id) references public.sales_channels (id, organization_id),
  check (discounts_cents <= gross_revenue_cents)
);
create index observations_org_date on public.sales_observations (organization_id, observed_at);
create unique index observations_ref_uniq on public.sales_observations (organization_id, external_reference) where external_reference is not null;

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null check (char_length(file_name) <= 200),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  import_type text not null check (import_type in ('categories', 'items', 'costs', 'prices', 'fees', 'sales')),
  status text not null default 'previewed' check (status in ('previewed', 'completed', 'cancelled', 'failed')),
  total_rows integer not null default 0,
  successful_rows integer not null default 0,
  failed_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id)
);
create unique index import_jobs_hash_uniq on public.import_jobs (organization_id, import_type, file_hash) where status in ('completed', 'previewed');

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_job_id uuid not null,
  row_number integer not null,
  data jsonb not null,
  status text not null default 'valid' check (status in ('valid', 'error', 'duplicate', 'applied')),
  error_code text,
  error_message text check (char_length(error_message) <= 300),
  foreign key (import_job_id, organization_id) references public.import_jobs (id, organization_id) on delete cascade,
  unique (import_job_id, row_number)
);

create table public.pr_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (char_length(type) <= 40),
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 300),
  resource_type text check (char_length(resource_type) <= 40),
  resource_id uuid,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- só FK para organization_members (nunca também para organizations): evita PGRST201 no embed do Core
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index pr_notifications_user on public.pr_notifications (user_id, organization_id, read_at, created_at desc);
create unique index pr_notifications_dedupe on public.pr_notifications (organization_id, user_id, dedupe_key) where dedupe_key is not null;

create table public.pr_notification_prefs (
  organization_id uuid not null,
  user_id uuid not null,
  type text not null,
  enabled boolean not null default true,
  primary key (organization_id, user_id, type),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

-- ======================================================================= RLS e privilégios
do $$
declare t text;
begin
  foreach t in array array['pr_settings', 'product_categories', 'pricing_items', 'sales_channels', 'item_channel_prices', 'cost_components', 'cost_model_versions', 'channel_fee_rules', 'tax_profiles',
    'pricing_policies', 'pricing_policy_versions', 'pricing_rule_assignments', 'price_lists', 'price_list_versions', 'price_list_items', 'pricing_scenarios', 'pricing_scenario_versions',
    'pricing_scenario_items', 'price_change_requests', 'price_change_events', 'sales_observations', 'import_jobs', 'import_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.pr_can_read(organization_id))', t || '_select', t);
  end loop;
  foreach t in array array['pr_notifications', 'pr_notification_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) and private.pr_can_read(organization_id))', t || '_select', t);
  end loop;
end $$;

-- Cadastros: escrita direta por RLS + privilégio por coluna. Preço atual NUNCA é coluna gravável (só por aprovação/publicação).
grant update (timezone, default_target_margin_pct, default_minimum_margin_pct, default_rounding, price_review_days, near_minimum_margin_pp, segregation_of_duties) on public.pr_settings to authenticated;
create policy pr_settings_update on public.pr_settings for update to authenticated using (private.pr_is_admin(organization_id)) with check (private.pr_is_admin(organization_id));

grant insert (organization_id, parent_id, name, description), update (name, description, active, parent_id) on public.product_categories to authenticated;
create policy categories_insert on public.product_categories for insert to authenticated with check (private.pr_is_manager(organization_id));
create policy categories_update on public.product_categories for update to authenticated using (private.pr_is_manager(organization_id)) with check (private.pr_is_manager(organization_id));

grant insert (organization_id, category_id, item_type, sku, name, description, unit), update (category_id, sku, name, description, unit, status, archived_at) on public.pricing_items to authenticated;
create policy items_insert on public.pricing_items for insert to authenticated with check (private.pr_is_analyst(organization_id));
create policy items_update on public.pricing_items for update to authenticated using (private.pr_is_analyst(organization_id)) with check (private.pr_is_analyst(organization_id));

grant insert (organization_id, name, channel_type, description, tax_profile_id), update (name, channel_type, description, tax_profile_id, active) on public.sales_channels to authenticated;
create policy channels_insert on public.sales_channels for insert to authenticated with check (private.pr_is_manager(organization_id));
create policy channels_update on public.sales_channels for update to authenticated using (private.pr_is_manager(organization_id)) with check (private.pr_is_manager(organization_id));

grant insert (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity, usage, unit, allocation_method),
      update (cost_type, name, amount_cents, quantity, usage, unit, allocation_method, active), delete on public.cost_components to authenticated;
create policy components_insert on public.cost_components for insert to authenticated with check (private.pr_is_analyst(organization_id));
create policy components_update on public.cost_components for update to authenticated using (private.pr_is_analyst(organization_id)) with check (private.pr_is_analyst(organization_id));
create policy components_delete on public.cost_components for delete to authenticated using (private.pr_is_analyst(organization_id));

grant insert (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, minimum_amount_cents, maximum_amount_cents, priority, valid_from, valid_until),
      update (name, fee_type, basis, rate_decimal, fixed_amount_cents, minimum_amount_cents, maximum_amount_cents, priority, active, valid_from, valid_until) on public.channel_fee_rules to authenticated;
create policy fee_rules_insert on public.channel_fee_rules for insert to authenticated with check (private.pr_is_manager(organization_id));
create policy fee_rules_update on public.channel_fee_rules for update to authenticated using (private.pr_is_manager(organization_id)) with check (private.pr_is_manager(organization_id));

grant insert (organization_id, name, description, configuration_json), update (name, description, configuration_json, active) on public.tax_profiles to authenticated;
create policy tax_profiles_insert on public.tax_profiles for insert to authenticated with check (private.pr_is_admin(organization_id));
create policy tax_profiles_update on public.tax_profiles for update to authenticated using (private.pr_is_admin(organization_id)) with check (private.pr_is_admin(organization_id));

-- Política: rascunho editável pelo gestor; o status só muda pelas funções (publicar/aposentar).
grant insert (organization_id, name, description, target_margin_decimal, minimum_margin_decimal, max_discount_decimal, rounding_rule, min_price_cents),
      update (name, description, target_margin_decimal, minimum_margin_decimal, max_discount_decimal, rounding_rule, min_price_cents) on public.pricing_policies to authenticated;
create policy policies_insert on public.pricing_policies for insert to authenticated with check (private.pr_is_manager(organization_id));
create policy policies_update on public.pricing_policies for update to authenticated using (private.pr_is_manager(organization_id)) with check (private.pr_is_manager(organization_id));

grant insert (organization_id, policy_id, category_id, channel_id, item_id, valid_from, valid_until), update (valid_from, valid_until), delete on public.pricing_rule_assignments to authenticated;
create policy assignments_insert on public.pricing_rule_assignments for insert to authenticated with check (private.pr_is_manager(organization_id));
create policy assignments_update on public.pricing_rule_assignments for update to authenticated using (private.pr_is_manager(organization_id)) with check (private.pr_is_manager(organization_id));
create policy assignments_delete on public.pricing_rule_assignments for delete to authenticated using (private.pr_is_manager(organization_id));

grant insert (organization_id, name, description, channel_id, valid_from, valid_until), update (name, description, channel_id, status, valid_from, valid_until) on public.price_lists to authenticated;
create policy price_lists_insert on public.price_lists for insert to authenticated with check (private.pr_is_analyst(organization_id));
create policy price_lists_update on public.price_lists for update to authenticated using (private.pr_is_analyst(organization_id)) with check (private.pr_is_analyst(organization_id));

-- Versões e itens de lista: escritos por função (rascunho) — sem privilégio direto de escrita.
-- Notificações: o usuário só marca as próprias como lidas (por função); preferências por função.

-- MFA no banco (mesma regra do Core): sem AAL2 não escreve, nem pela API REST direta.
do $$
declare t text;
begin
  foreach t in array array['pr_settings', 'product_categories', 'pricing_items', 'sales_channels', 'cost_components', 'channel_fee_rules', 'tax_profiles', 'pricing_policies', 'pricing_rule_assignments', 'price_lists'] loop
    if t in ('cost_components', 'pricing_rule_assignments') then
      execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
    end if;
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    if t <> 'pr_settings' then
      execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    end if;
  end loop;
end $$;

commit;

-- Precificação Inteligente — GUARDAS (parte 2): helpers, avaliação direta (espelho do motor TS), gatilhos de integridade e imutabilidade.

begin;
set local check_function_bodies = off;

-- ======================================================================= helpers
create function private.pr_tz(org uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.timezone from public.pr_settings s where s.organization_id = org), 'America/Sao_Paulo');
$$;
create function private.pr_today(org uuid) returns date
language sql stable set search_path = '' as $$ select (now() at time zone private.pr_tz(org))::date; $$;

create function private.pr_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_cents < 0 then '-' else '' end || 'R$ ' || (abs(p_cents) / 100)::text || ',' || lpad((abs(p_cents) % 100)::text, 2, '0');
$$;

create function private.pr_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  ok := case p_level when 'admin' then private.pr_is_admin(p_org) when 'manager' then private.pr_is_manager(p_org)
                     when 'analyst' then private.pr_is_analyst(p_org) else private.pr_can_read(p_org) end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.pr_guard(uuid, text) from public, anon;
grant execute on function private.pr_guard(uuid, text) to authenticated;

-- ======================================================================= avaliação direta (espelho de lib/pricing/engine/evaluate.ts)
-- fees: [{"id","name","kind","basis","rate_pct","fixed_cents","min_cents","max_cents"}]. Arredondamento meio-para-cima (round() do numeric para positivos).
create function private.pr_evaluate(p_price bigint, p_qty numeric, p_cost numeric, p_overhead numeric, p_fees jsonb, p_markup_full boolean default false)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  rev numeric; cvar numeric; f jsonb; basis text; raw numeric; amt numeric; capped text; mn numeric; mx numeric;
  price_fees numeric := 0; total numeric := 0; net numeric; out_fees jsonb := '[]'::jsonb; contrib numeric; margin numeric;
  base numeric; markup numeric; ovh numeric; mgr numeric;
begin
  if p_price is null or p_price <= 0 then raise exception 'preço inválido' using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantidade inválida' using errcode = '22023'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'custo variável inválido' using errcode = '22023'; end if;
  rev := round(p_price::numeric * p_qty);
  cvar := round(p_cost * p_qty);
  -- 1ª passada: sobre preço, sobre custo e fixas
  for f in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    basis := f ->> 'basis';
    continue when basis = 'net_price';
    raw := case basis
      when 'price' then (f ->> 'rate_pct')::numeric / 100 * rev
      when 'cost' then (f ->> 'rate_pct')::numeric / 100 * cvar
      when 'fixed_unit' then (f ->> 'fixed_cents')::numeric * p_qty
      when 'fixed_transaction' then (f ->> 'fixed_cents')::numeric
      else null end;
    if raw is null then raise exception 'taxa inválida (base %)', basis using errcode = '22023'; end if;
    mn := nullif(f ->> 'min_cents', '')::numeric; mx := nullif(f ->> 'max_cents', '')::numeric; capped := null; amt := raw;
    if mn is not null and amt < mn then amt := mn; capped := 'min'; end if;
    if mx is not null and amt > mx then amt := mx; capped := 'max'; end if;
    amt := round(amt);
    if basis = 'price' then price_fees := price_fees + amt; end if;
    total := total + amt;
    out_fees := out_fees || jsonb_build_object('id', f ->> 'id', 'amount_cents', amt, 'capped', capped);
  end loop;
  -- 2ª passada: sobre o preço líquido (receita − taxas sobre preço já limitadas)
  net := greatest(0, rev - price_fees);
  for f in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    continue when (f ->> 'basis') <> 'net_price';
    raw := (f ->> 'rate_pct')::numeric / 100 * net;
    mn := nullif(f ->> 'min_cents', '')::numeric; mx := nullif(f ->> 'max_cents', '')::numeric; capped := null; amt := raw;
    if mn is not null and amt < mn then amt := mn; capped := 'min'; end if;
    if mx is not null and amt > mx then amt := mx; capped := 'max'; end if;
    amt := round(amt);
    total := total + amt;
    out_fees := out_fees || jsonb_build_object('id', f ->> 'id', 'amount_cents', amt, 'capped', capped);
  end loop;
  contrib := rev - cvar - total;
  margin := case when rev > 0 then contrib / rev end;
  base := case when p_markup_full then p_cost + coalesce(p_overhead, 0) else p_cost end;
  markup := case when base > 0 then (p_price - base) / base end;
  ovh := case when p_overhead is null then null else round(p_overhead * p_qty) end;
  mgr := case when ovh is null then null else contrib - ovh end;
  return jsonb_build_object(
    'revenue_cents', rev, 'variable_cost_cents', cvar, 'fees', out_fees, 'total_fees_cents', total, 'contribution_cents', contrib,
    'margin_pct', case when margin is null then null else round(margin * 100, 4) end,
    'markup_pct', case when markup is null then null else round(markup * 100, 4) end,
    'overhead_cents', ovh, 'managerial_cents', mgr,
    'managerial_margin_pct', case when mgr is null or rev <= 0 then null else round(mgr / rev * 100, 4) end);
end $$;
revoke all on function private.pr_evaluate(bigint, numeric, numeric, numeric, jsonb, boolean) from public, anon, authenticated;

-- Custo unitário dos componentes de um item (espelho de lib/pricing/engine/costs.ts). Desconhecido NÃO é zero.
create function private.pr_unit_costs(p_item uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  c record; direct_n integer := 0; direct_known boolean := true; direct_sum numeric := 0; ovh_n integer := 0; ovh_known boolean := true; ovh_sum numeric := 0;
  u numeric; issues jsonb := '[]'::jsonb; status text; full_ numeric;
begin
  for c in select * from public.cost_components where item_id = p_item and active and cost_class = 'direct' order by created_at, id loop
    direct_n := direct_n + 1;
    if c.amount_cents is null then
      direct_known := false;
      issues := issues || jsonb_build_object('code', 'unknown_cost', 'component_id', c.id);
    else direct_sum := direct_sum + c.amount_cents * c.usage / c.quantity; end if;
  end loop;
  if direct_n = 0 then direct_known := false; issues := issues || jsonb_build_object('code', 'no_cost'); end if;
  for c in select * from public.cost_components where item_id = p_item and active and cost_class = 'overhead' order by created_at, id loop
    ovh_n := ovh_n + 1; u := null;
    if c.allocation_method = 'percent' then
      if direct_known and c.usage is not null then u := direct_sum * c.usage / 100; end if;
    elsif c.amount_cents is null then u := null;
    elsif c.allocation_method = 'manual' then u := c.amount_cents;
    elsif c.allocation_method = 'hours' then u := c.amount_cents / c.quantity * c.usage;
    else u := c.amount_cents / c.quantity; end if;
    if u is null then ovh_known := false; issues := issues || jsonb_build_object('code', 'unknown_overhead', 'component_id', c.id); else ovh_sum := ovh_sum + u; end if;
  end loop;
  status := case when ovh_n = 0 then 'none' when ovh_known then 'known' else 'unknown' end;
  full_ := case when direct_known and status <> 'unknown' then direct_sum + ovh_sum end;
  return jsonb_build_object(
    'complete', direct_known, 'issues', issues,
    'direct_unit_cents', case when direct_known then round(direct_sum, 6) end,
    'overhead_status', status,
    'overhead_unit_cents', case when status = 'known' then round(ovh_sum, 6) end,
    'full_unit_cents', case when full_ is not null then round(full_, 6) end);
end $$;
revoke all on function private.pr_unit_costs(uuid) from public, anon, authenticated;

-- ======================================================================= validação do perfil tributário (parâmetros INFORMADOS, D-P12)
create function private.pr_validate_tax_config(p_cfg jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare t jsonb; price_sum numeric := 0; r numeric;
begin
  if jsonb_typeof(p_cfg -> 'taxes') is distinct from 'array' then raise exception 'perfil tributário: lista de tributos ausente' using errcode = '23514'; end if;
  if jsonb_array_length(p_cfg -> 'taxes') > 30 then raise exception 'perfil tributário: máximo de 30 tributos' using errcode = '23514'; end if;
  for t in select * from jsonb_array_elements(p_cfg -> 'taxes') loop
    if coalesce(trim(t ->> 'name'), '') = '' or char_length(t ->> 'name') > 80 then raise exception 'perfil tributário: nome do tributo obrigatório (até 80 caracteres)' using errcode = '23514'; end if;
    if coalesce(trim(t ->> 'source'), '') = '' then raise exception 'perfil tributário: informe a origem do parâmetro (ex.: orientação do contador)' using errcode = '23514'; end if;
    if (t ->> 'basis') not in ('price', 'net_price') then raise exception 'perfil tributário: base deve ser price ou net_price' using errcode = '23514'; end if;
    begin r := (t ->> 'rate_pct')::numeric; exception when others then raise exception 'perfil tributário: alíquota inválida' using errcode = '23514'; end;
    if r is null or r < 0 or r > 100 then raise exception 'perfil tributário: alíquota deve estar entre 0 e 100' using errcode = '23514'; end if;
    if (t ->> 'basis') = 'price' then price_sum := price_sum + r; end if;
  end loop;
  if price_sum >= 100 then raise exception 'perfil tributário: a soma das alíquotas sobre o preço chega a 100 %% ou mais' using errcode = '23514'; end if;
end $$;
create function private.pr_tax_profile_guard() returns trigger language plpgsql set search_path = '' as $$
begin perform private.pr_validate_tax_config(new.configuration_json); return new; end $$;
create trigger tax_profile_guard before insert or update on public.tax_profiles for each row execute function private.pr_tax_profile_guard();

-- ======================================================================= padrões por empresa
create function private.pr_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pr_settings (organization_id) values (org) on conflict do nothing;
end $$;
revoke all on function private.pr_bootstrap_org(uuid) from public, anon, authenticated;
create function private.pr_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.pr_bootstrap_org(new.id); return null; end $$;
revoke all on function private.pr_on_org_created() from public, anon, authenticated;
create trigger pr_on_org_created after insert on public.organizations for each row execute function private.pr_on_org_created();
select private.pr_bootstrap_org(id) from public.organizations;

-- ======================================================================= updated_at e auditoria (só metadados do cadastro)
do $$
declare t text;
begin
  foreach t in array array['pr_settings', 'pricing_items', 'cost_components', 'channel_fee_rules', 'tax_profiles', 'pricing_policies', 'price_lists', 'pricing_scenarios'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['pr_settings', 'product_categories', 'pricing_items', 'sales_channels', 'cost_components', 'channel_fee_rules', 'tax_profiles', 'pricing_policies',
    'pricing_rule_assignments', 'price_lists', 'pricing_scenarios'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'pr_settings' then 'organization_id' else 'id' end);
  end loop;
end $$;

-- ======================================================================= imutabilidade (vale até para o dono do schema)
create function private.pr_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.pr_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: % (crie uma nova versão)', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.pr_no_delete() from public, anon, authenticated;
revoke all on function private.pr_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['pricing_items', 'product_categories', 'sales_channels', 'channel_fee_rules', 'tax_profiles', 'pricing_policies', 'price_lists', 'pricing_scenarios',
    'price_change_requests', 'sales_observations'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.pr_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['cost_model_versions', 'pricing_policy_versions', 'pricing_scenario_versions', 'pricing_scenario_items', 'price_change_events'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.pr_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- Arquivar item é do gestor (analista cria e edita, não arquiva).
create function private.pr_item_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and (new.archived_at is distinct from old.archived_at or new.status is distinct from old.status) and not private.pr_is_manager(new.organization_id) then
    raise exception 'apenas gestor ou administrador arquiva ou inativa itens' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger item_guard before update on public.pricing_items for each row execute function private.pr_item_guard();

-- Categoria: sem ciclos.
create function private.pr_category_guard() returns trigger language plpgsql set search_path = '' as $$
declare p uuid := new.parent_id; n integer := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'categoria não pode ser pai de si mesma' using errcode = '23514'; end if;
  while p is not null and n < 50 loop
    if p = new.id then raise exception 'ciclo na árvore de categorias' using errcode = '23514'; end if;
    select c.parent_id into p from public.product_categories c where c.id = p; n := n + 1;
  end loop;
  return new;
end $$;
create trigger category_guard before insert or update on public.product_categories for each row execute function private.pr_category_guard();

-- Componente de custo: item arquivado não recebe custo; custo-base zero precisa ser digitado (aqui só garante coerência).
create function private.pr_component_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.pricing_items i where i.id = new.item_id and i.archived_at is not null) then raise exception 'item arquivado não recebe alterações de custo' using errcode = '23514'; end if;
  return new;
end $$;
create trigger component_guard before insert or update on public.cost_components for each row execute function private.pr_component_guard();

-- Versão de lista: transições válidas; publicada só vira «aposentada»; rascunhos mudam livremente pelas funções.
create function private.pr_list_version_guard() returns trigger language plpgsql set search_path = '' as $$
declare keep text[] := array['status', 'submitted_by', 'reviewed_by', 'review_note', 'reviewed_at', 'published_at', 'published_by'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'só rascunhos de lista podem ser descartados' using errcode = '23514'; end if;
    return old;
  end if;
  if old.status = 'draft' then return new; end if;
  if old.status = 'pending' and new.status in ('approved', 'rejected', 'draft') then null;
  elsif old.status = 'approved' and new.status in ('published', 'rejected', 'draft') then null;
  elsif old.status = 'published' and new.status = 'retired' then null;
  elsif old.status = new.status then raise exception 'versão de lista % é imutável', old.status using errcode = '23514';
  else raise exception 'transição inválida de % para % na versão da lista', old.status, new.status using errcode = '23514'; end if;
  if (to_jsonb(new) - keep) <> (to_jsonb(old) - keep) and not (old.status = 'published' and new.status = 'retired') then
    raise exception 'versão de lista não aceita edição fora do rascunho' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger list_version_guard before update or delete on public.price_list_versions for each row execute function private.pr_list_version_guard();

-- Itens da lista só mudam enquanto a versão é rascunho.
create function private.pr_list_item_guard() returns trigger language plpgsql set search_path = '' as $$
declare v uuid := coalesce(new.price_list_version_id, old.price_list_version_id); st public.pr_list_status;
begin
  select status into st from public.price_list_versions where id = v;
  if st is distinct from 'draft' then raise exception 'versão de lista % não aceita alteração de itens', st using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
create trigger list_item_guard before insert or update or delete on public.price_list_items for each row execute function private.pr_list_item_guard();

-- Solicitação de preço: transições válidas e campos centrais imutáveis.
create function private.pr_request_guard() returns trigger language plpgsql set search_path = '' as $$
declare keep text[] := array['status', 'reviewed_by', 'review_note', 'reviewed_at', 'published_by', 'published_at', 'impact_json'];
begin
  if (to_jsonb(new) - keep) <> (to_jsonb(old) - keep) then raise exception 'solicitação de preço não pode ser editada: cancele e proponha de novo' using errcode = '23514'; end if;
  if old.status = new.status then return new; end if;
  if (old.status, new.status) in (('draft', 'pending'), ('draft', 'cancelled'), ('pending', 'approved'), ('pending', 'rejected'), ('pending', 'cancelled'), ('approved', 'published'), ('approved', 'cancelled')) then return new; end if;
  raise exception 'transição inválida de % para % na solicitação', old.status, new.status using errcode = '23514';
end $$;
create trigger request_guard before update on public.price_change_requests for each row execute function private.pr_request_guard();

-- Observações de venda não são editáveis (só inclusão por importação/função).
create function private.pr_observation_guard() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'venda observada é imutável' using errcode = '23514'; end $$;
create trigger observation_guard before update on public.sales_observations for each row execute function private.pr_observation_guard();

commit;

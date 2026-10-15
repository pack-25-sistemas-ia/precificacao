-- Precificação Inteligente — CENÁRIOS (snapshots imutáveis recalculados no banco) e ENTRADAS DA ANÁLISE (dados filtrados para o painel).
-- O navegador/servidor envia só PARÂMETROS e, opcionalmente, o preço sugerido pelo solver; todos os resultados gravados são recalculados aqui (D-P2).

begin;
set local check_function_bodies = off;

create function public.pr_save_scenario(p_org uuid, p_scenario uuid, p_name text, p_description text, p_items jsonb, p_engine_version text default '1.0.0') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sc record; sid uuid; vid uuid; n integer; e jsonb; ctx jsonb; ev jsonb; ev_s jsonb; cost_ jsonb; fees_ jsonb; rules jsonb; day_ date := private.pr_today(p_org);
  base_price bigint; disc numeric; final_price bigint; qty numeric; adj numeric; extra numeric; unit_cost numeric; ovh numeric; target numeric; sug bigint; verified boolean;
  flags text[]; margin numeric; minm numeric; minp bigint; inputs jsonb := '[]'::jsonb; outputs jsonb := '[]'::jsonb; rows_ jsonb := '[]'::jsonb; it record; ch record;
begin
  perform private.pr_guard(p_org, 'analyst');
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome do cenário: 1 a 80 caracteres' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then raise exception 'o cenário precisa de 1 a 200 itens' using errcode = '22023'; end if;
  if p_scenario is null then
    begin
      insert into public.pricing_scenarios (organization_id, name, description, created_by) values (p_org, trim(p_name), nullif(trim(p_description), ''), (select auth.uid())) returning id into sid;
    exception when unique_violation then raise exception 'já existe um cenário com este nome' using errcode = '23505'; end;
    n := 1;
  else
    select * into sc from public.pricing_scenarios where id = p_scenario and organization_id = p_org for update;
    if not found then raise exception 'cenário não encontrado' using errcode = 'P0002'; end if;
    if sc.status = 'archived' then raise exception 'cenário arquivado não recebe novas versões' using errcode = '23514'; end if;
    sid := p_scenario;
    select coalesce(max(version_number), 0) + 1 into n from public.pricing_scenario_versions where scenario_id = sid;
    update public.pricing_scenarios set description = coalesce(nullif(trim(p_description), ''), description) where id = sid;
  end if;

  for e in select * from jsonb_array_elements(p_items) loop
    select i.id, i.sku, i.name into it from public.pricing_items i where i.id = (e ->> 'item_id')::uuid and i.organization_id = p_org and i.archived_at is null;
    if it.id is null then raise exception 'item inexistente, arquivado ou de outra empresa no cenário' using errcode = '22023'; end if;
    select c.id, c.name into ch from public.sales_channels c where c.id = (e ->> 'channel_id')::uuid and c.organization_id = p_org;
    if ch.id is null then raise exception 'canal inexistente ou de outra empresa no cenário' using errcode = '22023'; end if;
    ctx := private.pr_item_context(p_org, it.id, ch.id, day_);
    cost_ := ctx -> 'cost';
    if cost_ is null or jsonb_typeof(cost_) = 'null' then raise exception 'item «%» sem versão de custo: não pode entrar no cenário', it.sku using errcode = '23514'; end if;
    fees_ := ctx -> 'fees'; rules := ctx -> 'policy' -> 'rules';
    base_price := coalesce(nullif(e ->> 'price_cents', '')::bigint, nullif(ctx ->> 'current_price_cents', '')::bigint);
    if base_price is null or base_price <= 0 then raise exception 'item «%»: informe o preço do cenário (não há preço atual)', it.sku using errcode = '22023'; end if;
    qty := coalesce(nullif(e ->> 'quantity', '')::numeric, 1);
    adj := coalesce(nullif(e ->> 'cost_adjust_pct', '')::numeric, 0);
    extra := coalesce(nullif(e ->> 'extra_cost_cents', '')::numeric, 0);
    disc := coalesce(nullif(e ->> 'discount_pct', '')::numeric, 0);
    if qty <= 0 or adj < -100 or adj > 1000 or extra < 0 or disc < 0 or disc >= 100 then raise exception 'item «%»: parâmetros do cenário fora dos limites (quantidade, ajuste de custo, custo extra ou desconto)', it.sku using errcode = '22023'; end if;
    final_price := greatest(1, round(base_price::numeric * (1 - disc / 100)))::bigint;
    unit_cost := (cost_ ->> 'direct_unit_cents')::numeric * (1 + adj / 100) + extra;
    ovh := nullif(cost_ ->> 'overhead_unit_cents', '')::numeric;
    target := coalesce(nullif(e ->> 'target_margin_pct', '')::numeric, (rules ->> 'target_margin_pct')::numeric);
    if target < 0 or target >= 100 then raise exception 'item «%»: margem-alvo fora do intervalo', it.sku using errcode = '22023'; end if;
    ev := private.pr_evaluate(final_price, qty, unit_cost, ovh, fees_);
    margin := nullif(ev ->> 'margin_pct', '')::numeric;
    minm := (rules ->> 'minimum_margin_pct')::numeric; minp := nullif(rules ->> 'min_price_cents', '')::bigint;
    flags := '{}';
    if (ev ->> 'contribution_cents')::numeric < 0 then flags := array_append(flags, 'negative_contribution'::text); end if;
    if margin is null or margin < minm then flags := array_append(flags, 'below_minimum_margin'::text); end if;
    if minp is not null and final_price < minp then flags := array_append(flags, 'below_min_price'::text); end if;
    -- sugestão do solver: o banco CONFERE pela avaliação direta (atinge a meta?) e mede quanto falta
    sug := nullif(e ->> 'suggested_price_cents', '')::bigint; verified := null; ev_s := null;
    if sug is not null then
      if sug <= 0 then raise exception 'item «%»: preço sugerido inválido', it.sku using errcode = '22023'; end if;
      ev_s := private.pr_evaluate(sug, qty, unit_cost, ovh, fees_);
      -- verificada = atinge a meta E é (quase) o menor preço que a atinge: 2 centavos a menos já não atende. Preço sugerido forjado e alto demais falha aqui.
      verified := (ev_s ->> 'contribution_cents')::numeric * 100 >= target * (ev_s ->> 'revenue_cents')::numeric;
      if verified and sug > 2 then
        ev_s := private.pr_evaluate(sug - 2, qty, unit_cost, ovh, fees_);
        if (ev_s ->> 'contribution_cents')::numeric * 100 >= target * (ev_s ->> 'revenue_cents')::numeric then verified := false; end if;
        ev_s := private.pr_evaluate(sug, qty, unit_cost, ovh, fees_);
      end if;
    end if;
    inputs := inputs || jsonb_build_object('item_id', it.id, 'channel_id', ch.id, 'overrides', jsonb_build_object('price_cents', base_price, 'quantity', qty, 'cost_adjust_pct', adj, 'extra_cost_cents', extra,
      'discount_pct', disc, 'target_margin_pct', target, 'suggested_price_cents', sug), 'context', ctx);
    outputs := outputs || jsonb_build_object('item_id', it.id, 'channel_id', ch.id, 'final_price_cents', final_price, 'evaluation', ev, 'flags', to_jsonb(flags), 'suggested_price_cents', sug,
      'suggestion_verified', verified, 'suggestion_evaluation', ev_s, 'target_margin_pct', target);
    rows_ := rows_ || jsonb_build_object('item', it.id, 'channel', ch.id, 'input_price', base_price, 'final', final_price, 'sug', sug, 'verified', verified, 'cost', (ev ->> 'variable_cost_cents')::bigint,
      'fees', (ev ->> 'total_fees_cents')::bigint, 'contrib', (ev ->> 'contribution_cents')::bigint, 'margin', margin, 'markup', nullif(ev ->> 'markup_pct', '')::numeric, 'viable', cardinality(flags) = 0);
  end loop;

  insert into public.pricing_scenario_versions (organization_id, scenario_id, version_number, input_snapshot_json, output_snapshot_json, engine_version, created_by)
  values (p_org, sid, n, jsonb_build_object('items', inputs, 'saved_on', day_), jsonb_build_object('items', outputs), left(coalesce(p_engine_version, ''), 20), (select auth.uid())) returning id into vid;
  insert into public.pricing_scenario_items (organization_id, scenario_version_id, pricing_item_id, channel_id, input_price_cents, suggested_price_cents, suggestion_verified, direct_cost_cents, fees_cents, contribution_cents, margin_decimal, markup_decimal, viable)
  select p_org, vid, (r ->> 'item')::uuid, (r ->> 'channel')::uuid, (r ->> 'final')::bigint, nullif(r ->> 'sug', '')::bigint, nullif(r ->> 'verified', '')::boolean, (r ->> 'cost')::bigint, (r ->> 'fees')::bigint,
         (r ->> 'contrib')::bigint, nullif(r ->> 'margin', '')::numeric, nullif(r ->> 'markup', '')::numeric, (r ->> 'viable')::boolean
    from jsonb_array_elements(rows_) r;
  perform private.pr_audit(p_org, 'scenario_saved', 'pricing_scenarios', sid, jsonb_build_object('version', n, 'items', jsonb_array_length(rows_)));
  return jsonb_build_object('scenario_id', sid, 'version_id', vid, 'version_number', n);
end $$;

create function public.pr_archive_scenario(p_org uuid, p_scenario uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sc record;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into sc from public.pricing_scenarios where id = p_scenario and organization_id = p_org for update;
  if not found then raise exception 'cenário não encontrado' using errcode = 'P0002'; end if;
  if sc.created_by is distinct from (select auth.uid()) and not private.pr_is_manager(p_org) then raise exception 'só quem criou ou a gestão arquiva o cenário' using errcode = '42501'; end if;
  update public.pricing_scenarios set status = 'archived' where id = p_scenario;
  perform private.pr_audit(p_org, 'scenario_archived', 'pricing_scenarios', p_scenario, '{}'::jsonb);
end $$;

-- ======================================================================= entradas da análise (painel, relatórios): uma linha por item ativo × canal ativo
-- O servidor avalia cada linha com o MESMO motor; o banco entrega os dados já filtrados e com política/taxas resolvidas pelas regras de precedência.
create function public.pr_analysis_inputs(p_org uuid, p_category uuid default null, p_channel uuid default null, p_item_type text default null, p_item uuid default null, p_limit integer default 2000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare out_ jsonb := '[]'::jsonb; it record; ch record; ctx jsonb; uc jsonb; prev numeric; day_ date := private.pr_today(p_org); channels uuid[]; last_change timestamptz; cat_name text;
begin
  perform private.pr_guard(p_org, 'read');
  if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'limite inválido (1 a 5.000)' using errcode = '22023'; end if;
  if p_item_type is not null and p_item_type not in ('product', 'service') then raise exception 'tipo de item inválido' using errcode = '22023'; end if;
  for it in select i.* from public.pricing_items i where i.organization_id = p_org and i.archived_at is null and i.status = 'active'
      and (p_item is null or i.id = p_item) and (p_item_type is null or i.item_type::text = p_item_type)
      and (p_category is null or i.category_id = p_category or i.category_id in (with recursive t as (select id from public.product_categories where id = p_category and organization_id = p_org
           union all select c.id from public.product_categories c join t on c.parent_id = t.id) select id from t))
    order by i.sku limit p_limit loop
    uc := private.pr_unit_costs(it.id);
    select c.name into cat_name from public.product_categories c where c.id = it.category_id;
    select cm.direct_unit_cost_cents into prev from public.cost_model_versions cm where cm.item_id = it.id order by cm.version_number desc offset 1 limit 1;
    for ch in select c.id, c.name from public.sales_channels c where c.organization_id = p_org and c.active and (p_channel is null or c.id = p_channel) order by c.name loop
      ctx := private.pr_item_context(p_org, it.id, ch.id, day_);
      select max(e.effective_at) into last_change from public.price_change_events e where e.item_id = it.id and (e.channel_id = ch.id or e.channel_id is null);
      out_ := out_ || jsonb_build_object('item_id', it.id, 'sku', it.sku, 'name', it.name, 'item_type', it.item_type, 'category_id', it.category_id, 'category', cat_name,
        'channel_id', ch.id, 'channel', ch.name, 'price_cents', ctx -> 'current_price_cents', 'price_source', ctx -> 'price_source', 'price_reviewed_at', it.price_reviewed_at,
        'days_since_review', case when it.price_reviewed_at is null then null else (day_ - (it.price_reviewed_at at time zone private.pr_tz(p_org))::date) end,
        'last_price_change_at', last_change, 'cost', ctx -> 'cost', 'live_cost_complete', (uc ->> 'complete')::boolean, 'cost_issues', uc -> 'issues',
        'previous_direct_unit_cents', prev, 'fees', ctx -> 'fees', 'policy', ctx -> 'policy');
    end loop;
  end loop;
  return out_;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.pr_save_scenario(uuid, uuid, text, text, jsonb, text)', 'public.pr_archive_scenario(uuid, uuid)', 'public.pr_analysis_inputs(uuid, uuid, uuid, text, uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

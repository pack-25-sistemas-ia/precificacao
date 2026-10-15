-- Precificação Inteligente — MOTOR NO BANCO (parte 3): contexto de preço, versões de custo, políticas, solicitações de alteração de preço (aprovação e publicação).
-- O solver mora no TypeScript; aqui o banco RECALCULA pela avaliação direta (private.pr_evaluate) tudo que é gravado e confere sugestões (D-P2).

begin;
set local check_function_bodies = off;

-- ======================================================================= avisos e auditoria
create function private.pr_notify(p_org uuid, p_type text, p_title text, p_body text, p_resource_type text, p_resource_id uuid, p_dedupe text, p_roles public.org_role[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.pr_notifications (organization_id, user_id, type, title, body, resource_type, resource_id, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_resource_type, p_resource_id, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.role = any (p_roles)
    and coalesce((select pr.enabled from public.pr_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
create function private.pr_notify_user(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_resource_type text, p_resource_id uuid, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pr_notifications (organization_id, user_id, type, title, body, resource_type, resource_id, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_resource_type, p_resource_id, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user
    and coalesce((select pr.enabled from public.pr_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict do nothing;
end $$;
create function private.pr_audit(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, p_changes);
end $$;
revoke all on function private.pr_notify(uuid, text, text, text, text, uuid, text, public.org_role[]) from public, anon, authenticated;
revoke all on function private.pr_notify_user(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function private.pr_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create function public.pr_mark_notifications_read(p_org uuid, p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.pr_guard(p_org, 'read');
  update public.pr_notifications set read_at = now() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
create function public.pr_set_notification_pref(p_org uuid, p_type text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'read');
  if p_type is null or p_type !~ '^[a-z_]{3,40}$' then raise exception 'tipo de aviso inválido' using errcode = '22023'; end if;
  insert into public.pr_notification_prefs (organization_id, user_id, type, enabled) values (p_org, (select auth.uid()), p_type, coalesce(p_enabled, true))
  on conflict (organization_id, user_id, type) do update set enabled = excluded.enabled;
end $$;

-- ======================================================================= taxas do canal e política vigente (contexto do cálculo)
-- Taxas vigentes do canal na data + tributos INFORMADOS do perfil tributário do canal (viram taxas sobre preço/preço líquido).
create function private.pr_channel_fees(p_org uuid, p_channel uuid, p_date date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare out_ jsonb := '[]'::jsonb; r record; t jsonb; i integer := 0; cfg jsonb;
begin
  if p_channel is null then return out_; end if;
  for r in select * from public.channel_fee_rules f where f.organization_id = p_org and f.channel_id = p_channel and f.active
      and (f.valid_from is null or f.valid_from <= p_date) and (f.valid_until is null or p_date <= f.valid_until) order by f.priority, f.name, f.id loop
    out_ := out_ || jsonb_build_object('id', r.id::text, 'name', r.name, 'kind', r.fee_type::text, 'basis', r.basis::text, 'rate_pct', r.rate_decimal,
      'fixed_cents', r.fixed_amount_cents, 'min_cents', r.minimum_amount_cents, 'max_cents', r.maximum_amount_cents);
  end loop;
  select p.configuration_json into cfg from public.sales_channels c join public.tax_profiles p on p.id = c.tax_profile_id and p.organization_id = c.organization_id
   where c.id = p_channel and c.organization_id = p_org and p.active;
  if cfg is not null then
    for t in select * from jsonb_array_elements(cfg -> 'taxes') loop
      i := i + 1;
      continue when (t ->> 'valid_from') is not null and (t ->> 'valid_from')::date > p_date;
      continue when (t ->> 'valid_until') is not null and (t ->> 'valid_until')::date < p_date;
      out_ := out_ || jsonb_build_object('id', 'tax:' || i::text, 'name', t ->> 'name', 'kind', 'tax', 'basis', t ->> 'basis', 'rate_pct', (t ->> 'rate_pct')::numeric);
    end loop;
  end if;
  return out_;
end $$;

-- Política vigente (precedência por especificidade; só políticas PUBLICADAS valem). Sem nenhuma, vale o padrão da empresa.
create function private.pr_resolve_policy(p_org uuid, p_item uuid, p_channel uuid, p_date date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare cat uuid; a record; v record; scope text; s record;
begin
  select i.category_id into cat from public.pricing_items i where i.id = p_item and i.organization_id = p_org;
  for scope in select unnest(array['item_channel', 'item', 'category_channel', 'category', 'channel', 'global']) loop
    select x.* into a from public.pricing_rule_assignments x
      join public.pricing_policies p on p.id = x.policy_id and p.organization_id = x.organization_id and p.status = 'published'
     where x.organization_id = p_org and (x.valid_from is null or x.valid_from <= p_date) and (x.valid_until is null or p_date <= x.valid_until)
       and case scope
         when 'item_channel' then x.item_id = p_item and p_channel is not null and x.channel_id = p_channel
         when 'item' then x.item_id = p_item and x.channel_id is null
         when 'category_channel' then cat is not null and x.category_id = cat and p_channel is not null and x.channel_id = p_channel
         when 'category' then cat is not null and x.category_id = cat and x.channel_id is null
         when 'channel' then p_channel is not null and x.channel_id = p_channel and x.item_id is null and x.category_id is null
         else x.item_id is null and x.category_id is null and x.channel_id is null end
     order by x.created_at, x.id limit 1;
    if found then
      select pv.* into v from public.pricing_policy_versions pv where pv.policy_id = a.policy_id order by pv.version_number desc limit 1;
      if v.id is not null then
        return jsonb_build_object('scope', scope, 'assignment_id', a.id, 'policy_id', a.policy_id, 'version_id', v.id, 'version_number', v.version_number, 'rules', v.rules_snapshot_json);
      end if;
    end if;
  end loop;
  select * into s from public.pr_settings where organization_id = p_org;
  return jsonb_build_object('scope', 'default', 'assignment_id', null, 'policy_id', null, 'version_id', null, 'version_number', null,
    'rules', jsonb_build_object('target_margin_pct', s.default_target_margin_pct, 'minimum_margin_pct', s.default_minimum_margin_pct, 'max_discount_pct', null,
                                'rounding', s.default_rounding::text, 'min_price_cents', null));
end $$;

-- Contexto completo de um item × canal: custo vigente (última versão), taxas, política e preço atual.
create function private.pr_item_context(p_org uuid, p_item uuid, p_channel uuid, p_date date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare cv record; cur bigint; src text; base bigint;
begin
  select * into cv from public.cost_model_versions where item_id = p_item and organization_id = p_org order by version_number desc limit 1;
  select i.current_base_price_cents into base from public.pricing_items i where i.id = p_item and i.organization_id = p_org;
  if p_channel is not null then
    select price_cents into cur from public.item_channel_prices where item_id = p_item and channel_id = p_channel and organization_id = p_org;
    src := case when cur is not null then 'channel' when base is not null then 'base' end;
    cur := coalesce(cur, base);
  else cur := base; src := case when base is not null then 'base' end; end if;
  return jsonb_build_object(
    'cost', case when cv.id is null then null else jsonb_build_object('version_id', cv.id, 'version_number', cv.version_number, 'direct_unit_cents', cv.direct_unit_cost_cents,
      'overhead_unit_cents', cv.allocated_overhead_unit_cents, 'full_unit_cents', cv.full_unit_cost_cents) end,
    'fees', private.pr_channel_fees(p_org, p_channel, p_date),
    'policy', private.pr_resolve_policy(p_org, p_item, p_channel, p_date),
    'current_price_cents', cur, 'price_source', src);
end $$;

-- Avalia um preço no contexto e levanta as bandeiras que bloqueiam publicação.
create function private.pr_check_price(p_ctx jsonb, p_price bigint, p_qty numeric default 1) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare cost_ jsonb := p_ctx -> 'cost'; ev jsonb; flags text[] := '{}'; rules jsonb := p_ctx -> 'policy' -> 'rules'; margin numeric; minm numeric; minp bigint;
begin
  if cost_ is null or jsonb_typeof(cost_) = 'null' then raise exception 'item sem versão de custo: salve uma versão de custo antes de precificar' using errcode = '23514'; end if;
  ev := private.pr_evaluate(p_price, p_qty, (cost_ ->> 'direct_unit_cents')::numeric, nullif(cost_ ->> 'overhead_unit_cents', '')::numeric, p_ctx -> 'fees');
  margin := nullif(ev ->> 'margin_pct', '')::numeric;
  minm := (rules ->> 'minimum_margin_pct')::numeric;
  minp := nullif(rules ->> 'min_price_cents', '')::bigint;
  if (ev ->> 'contribution_cents')::numeric < 0 then flags := array_append(flags, 'negative_contribution'::text); end if;
  if margin is null or margin < minm then flags := array_append(flags, 'below_minimum_margin'::text); end if;
  if minp is not null and p_price < minp then flags := array_append(flags, 'below_min_price'::text); end if;
  return jsonb_build_object('evaluation', ev, 'flags', to_jsonb(flags));
end $$;
revoke all on function private.pr_channel_fees(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.pr_resolve_policy(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.pr_item_context(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.pr_check_price(jsonb, bigint, numeric) from public, anon, authenticated;

-- Leitura do contexto para a aplicação (análises, simulador): mesmas regras que o banco usa para validar.
create function public.pr_item_context(p_org uuid, p_item uuid, p_channel uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'read');
  if not exists (select 1 from public.pricing_items where id = p_item and organization_id = p_org) then raise exception 'item não encontrado' using errcode = 'P0002'; end if;
  if p_channel is not null and not exists (select 1 from public.sales_channels where id = p_channel and organization_id = p_org) then raise exception 'canal não encontrado' using errcode = 'P0002'; end if;
  return private.pr_item_context(p_org, p_item, p_channel, coalesce(p_date, private.pr_today(p_org)));
end $$;

-- ======================================================================= versões de custo (snapshot imutável)
create function public.pr_save_cost_version(p_org uuid, p_item uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare it record; uc jsonb; n integer; id_ uuid; prev record; comps jsonb;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into it from public.pricing_items where id = p_item and organization_id = p_org for update;
  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;
  if it.archived_at is not null then raise exception 'item arquivado não recebe nova versão de custo' using errcode = '23514'; end if;
  uc := private.pr_unit_costs(p_item);
  if not (uc ->> 'complete')::boolean then
    raise exception 'custo incompleto: %', case when exists (select 1 from jsonb_array_elements(uc -> 'issues') i where i ->> 'code' = 'no_cost') then 'nenhum componente de custo direto informado'
      else 'há componente sem valor (desconhecido não é zero)' end using errcode = '23514';
  end if;
  select jsonb_agg(jsonb_build_object('id', c.id, 'cost_class', c.cost_class, 'cost_type', c.cost_type, 'name', c.name, 'amount_cents', c.amount_cents, 'quantity', c.quantity, 'usage', c.usage,
    'unit', c.unit, 'allocation_method', c.allocation_method) order by c.created_at, c.id) into comps from public.cost_components c where c.item_id = p_item and c.active;
  select * into prev from public.cost_model_versions where item_id = p_item order by version_number desc limit 1;
  n := coalesce(prev.version_number, 0) + 1;
  insert into public.cost_model_versions (organization_id, item_id, version_number, snapshot_json, direct_unit_cost_cents, allocated_overhead_unit_cents, full_unit_cost_cents, note, created_by)
  values (p_org, p_item, n, jsonb_build_object('components', coalesce(comps, '[]'::jsonb), 'unit_costs', uc), (uc ->> 'direct_unit_cents')::numeric,
          nullif(uc ->> 'overhead_unit_cents', '')::numeric, nullif(uc ->> 'full_unit_cents', '')::numeric, nullif(trim(p_note), ''), (select auth.uid()))
  returning id into id_;
  perform private.pr_audit(p_org, 'cost_version', 'pricing_items', p_item, jsonb_build_object('version', n, 'direct_unit_cents', uc ->> 'direct_unit_cents'));
  -- aumento relevante de custo (≥ 5 %) avisa a gestão
  if prev.id is not null and prev.direct_unit_cost_cents > 0 and (uc ->> 'direct_unit_cents')::numeric >= prev.direct_unit_cost_cents * 1.05 then
    perform private.pr_notify(p_org, 'cost_increase', 'Custo subiu', left(it.sku || ' — ' || it.name, 200), 'pricing_item', p_item, 'cost_inc:' || id_::text, array['owner', 'admin', 'manager']::public.org_role[]);
  end if;
  return id_;
end $$;

-- ======================================================================= políticas: publicar versão imutável
create function public.pr_publish_policy(p_org uuid, p_policy uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare p record; n integer;
begin
  perform private.pr_guard(p_org, 'manager');
  select * into p from public.pricing_policies where id = p_policy and organization_id = p_org for update;
  if not found then raise exception 'política não encontrada' using errcode = 'P0002'; end if;
  if p.status = 'retired' then raise exception 'política aposentada não pode ser publicada' using errcode = '23514'; end if;
  select coalesce(max(version_number), 0) + 1 into n from public.pricing_policy_versions where policy_id = p_policy;
  insert into public.pricing_policy_versions (organization_id, policy_id, version_number, rules_snapshot_json, created_by)
  values (p_org, p_policy, n, jsonb_build_object('target_margin_pct', p.target_margin_decimal, 'minimum_margin_pct', p.minimum_margin_decimal, 'max_discount_pct', p.max_discount_decimal,
    'rounding', p.rounding_rule::text, 'min_price_cents', p.min_price_cents), (select auth.uid()));
  update public.pricing_policies set status = 'published' where id = p_policy;
  perform private.pr_audit(p_org, 'policy_published', 'pricing_policies', p_policy, jsonb_build_object('version', n));
  return n;
end $$;
create function public.pr_retire_policy(p_org uuid, p_policy uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'manager');
  if exists (select 1 from public.pricing_rule_assignments a where a.policy_id = p_policy and a.organization_id = p_org and (a.valid_until is null or a.valid_until >= private.pr_today(p_org))) then
    raise exception 'política com atribuições vigentes: remova ou encerre as atribuições antes' using errcode = '23514';
  end if;
  update public.pricing_policies set status = 'retired' where id = p_policy and organization_id = p_org and status <> 'retired';
  if not found then raise exception 'política não encontrada ou já aposentada' using errcode = 'P0002'; end if;
  perform private.pr_audit(p_org, 'policy_retired', 'pricing_policies', p_policy, '{}'::jsonb);
end $$;

-- ======================================================================= alteração de preço: propor → aprovar/rejeitar → publicar
create function public.pr_request_price_change(p_org uuid, p_item uuid, p_channel uuid, p_price bigint, p_justification text, p_source text default 'manual') returns uuid
language plpgsql security definer set search_path = '' as $$
declare it record; ctx jsonb; chk jsonb; prev bigint; id_ uuid; today_ date := private.pr_today(p_org);
begin
  perform private.pr_guard(p_org, 'analyst');
  if p_price is null or p_price <= 0 or p_price > 99999999999999 then raise exception 'preço inválido' using errcode = '22023'; end if;
  if p_justification is null or char_length(trim(p_justification)) < 5 then raise exception 'justificativa: mínimo de 5 caracteres' using errcode = '22023'; end if;
  if p_source not in ('manual', 'import', 'scenario') then raise exception 'origem inválida' using errcode = '22023'; end if;
  select * into it from public.pricing_items where id = p_item and organization_id = p_org;
  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;
  if it.archived_at is not null or it.status <> 'active' then raise exception 'item inativo ou arquivado não recebe proposta de preço' using errcode = '23514'; end if;
  if p_channel is not null and not exists (select 1 from public.sales_channels where id = p_channel and organization_id = p_org and active) then raise exception 'canal inativo ou não encontrado' using errcode = 'P0002'; end if;
  ctx := private.pr_item_context(p_org, p_item, p_channel, today_);
  prev := nullif(ctx ->> 'current_price_cents', '')::bigint;
  if prev is not null and prev = p_price then raise exception 'o preço proposto é igual ao atual' using errcode = '23514'; end if;
  chk := private.pr_check_price(ctx, p_price);
  begin
    insert into public.price_change_requests (organization_id, item_id, channel_id, previous_price_cents, proposed_price_cents, justification, impact_json, status, source, requested_by)
    values (p_org, p_item, p_channel, prev, p_price, trim(p_justification), jsonb_build_object('context', ctx, 'check', chk, 'computed_at', now()), 'pending', p_source, (select auth.uid()))
    returning id into id_;
  exception when unique_violation then
    raise exception 'já existe uma proposta em andamento para este item e canal' using errcode = '23505';
  end;
  perform private.pr_audit(p_org, 'price_requested', 'price_change_requests', id_, jsonb_build_object('item', p_item, 'channel', p_channel, 'previous', prev, 'proposed', p_price));
  perform private.pr_notify(p_org, 'approval_pending', 'Alteração de preço aguardando aprovação', left(it.sku || ' — ' || it.name, 200), 'price_change_request', id_, 'req:' || id_::text, array['owner', 'admin', 'manager']::public.org_role[]);
  return id_;
end $$;

create function public.pr_review_price_change(p_org uuid, p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; seg boolean;
begin
  perform private.pr_guard(p_org, 'manager');
  select * into r from public.price_change_requests where id = p_request and organization_id = p_org for update;
  if not found then raise exception 'solicitação não encontrada' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'solicitação já está %', case r.status when 'approved' then 'aprovada' when 'rejected' then 'rejeitada' when 'published' then 'publicada' when 'cancelled' then 'cancelada' else r.status::text end using errcode = '23514'; end if;
  select segregation_of_duties into seg from public.pr_settings where organization_id = p_org;
  if coalesce(seg, true) and r.requested_by = (select auth.uid()) then raise exception 'segregação de funções: quem propôs não pode aprovar ou rejeitar a própria alteração' using errcode = '42501'; end if;
  if not p_approve and (p_note is null or char_length(trim(p_note)) < 5) then raise exception 'informe o motivo da rejeição (mínimo de 5 caracteres)' using errcode = '22023'; end if;
  update public.price_change_requests set status = case when p_approve then 'approved' else 'rejected' end::public.pr_request_status, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_request;
  perform private.pr_audit(p_org, case when p_approve then 'price_approved' else 'price_rejected' end, 'price_change_requests', p_request, jsonb_build_object('note', nullif(trim(p_note), '')));
  perform private.pr_notify_user(p_org, r.requested_by, case when p_approve then 'price_approved' else 'price_rejected' end, case when p_approve then 'Alteração de preço aprovada' else 'Alteração de preço rejeitada' end,
    left(coalesce(p_note, ''), 200), 'price_change_request', p_request, 'rev:' || p_request::text);
end $$;

create function public.pr_cancel_price_change(p_org uuid, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into r from public.price_change_requests where id = p_request and organization_id = p_org for update;
  if not found then raise exception 'solicitação não encontrada' using errcode = 'P0002'; end if;
  if r.status not in ('pending', 'approved', 'draft') then raise exception 'solicitação não pode mais ser cancelada' using errcode = '23514'; end if;
  if r.requested_by <> (select auth.uid()) and not private.pr_is_manager(p_org) then raise exception 'só quem propôs ou a gestão cancela' using errcode = '42501'; end if;
  update public.price_change_requests set status = 'cancelled', reviewed_at = coalesce(reviewed_at, now()) where id = p_request;
  perform private.pr_audit(p_org, 'price_cancelled', 'price_change_requests', p_request, '{}'::jsonb);
end $$;

-- Publicar aplica o preço (uma única vez): trava a solicitação e o item, revalida custo/taxas/política AGORA e confere que o preço atual não mudou.
create function public.pr_publish_price_change(p_org uuid, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; ctx jsonb; chk jsonb; cur bigint; it record; today_ date := private.pr_today(p_org);
begin
  perform private.pr_guard(p_org, 'manager');
  select * into r from public.price_change_requests where id = p_request and organization_id = p_org for update;
  if not found then raise exception 'solicitação não encontrada' using errcode = 'P0002'; end if;
  if r.status = 'published' then raise exception 'solicitação já publicada' using errcode = '23514'; end if;
  if r.status <> 'approved' then raise exception 'só solicitações aprovadas podem ser publicadas' using errcode = '23514'; end if;
  select * into it from public.pricing_items where id = r.item_id and organization_id = p_org for update;
  if it.archived_at is not null or it.status <> 'active' then raise exception 'item inativo ou arquivado' using errcode = '23514'; end if;
  ctx := private.pr_item_context(p_org, r.item_id, r.channel_id, today_);
  cur := nullif(ctx ->> 'current_price_cents', '')::bigint;
  if cur is distinct from r.previous_price_cents then raise exception 'o preço atual mudou desde a proposta: cancele e proponha novamente' using errcode = '40001'; end if;
  chk := private.pr_check_price(ctx, r.proposed_price_cents);
  if chk -> 'flags' ? 'negative_contribution' then raise exception 'publicação bloqueada: a contribuição unitária ficaria negativa com os custos e taxas atuais' using errcode = '23514'; end if;
  if chk -> 'flags' ? 'below_min_price' then raise exception 'publicação bloqueada: preço abaixo do mínimo autorizado pela política' using errcode = '23514'; end if;
  if chk -> 'flags' ? 'below_minimum_margin' then raise exception 'publicação bloqueada: margem abaixo da mínima da política' using errcode = '23514'; end if;
  if r.channel_id is null then
    update public.pricing_items set current_base_price_cents = r.proposed_price_cents, price_reviewed_at = now() where id = r.item_id;
  else
    insert into public.item_channel_prices (organization_id, item_id, channel_id, price_cents, reviewed_at, updated_at) values (p_org, r.item_id, r.channel_id, r.proposed_price_cents, now(), now())
    on conflict (item_id, channel_id) do update set price_cents = excluded.price_cents, reviewed_at = now(), updated_at = now();
    update public.pricing_items set price_reviewed_at = now() where id = r.item_id;
  end if;
  insert into public.price_change_events (organization_id, request_id, item_id, channel_id, previous_price_cents, new_price_cents, created_by)
  values (p_org, p_request, r.item_id, r.channel_id, r.previous_price_cents, r.proposed_price_cents, (select auth.uid()));
  update public.price_change_requests set status = 'published', published_by = (select auth.uid()), published_at = now(), impact_json = r.impact_json || jsonb_build_object('published_check', chk) where id = p_request;
  perform private.pr_audit(p_org, 'price_published', 'price_change_requests', p_request, jsonb_build_object('item', r.item_id, 'channel', r.channel_id, 'previous', r.previous_price_cents, 'new', r.proposed_price_cents));
  perform private.pr_notify_user(p_org, r.requested_by, 'price_published', 'Preço publicado', left(it.sku || ' — ' || it.name, 200), 'price_change_request', p_request, 'pub:' || p_request::text);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.pr_mark_notifications_read(uuid, uuid[])', 'public.pr_set_notification_pref(uuid, text, boolean)', 'public.pr_item_context(uuid, uuid, uuid, date)',
    'public.pr_save_cost_version(uuid, uuid, text)', 'public.pr_publish_policy(uuid, uuid)', 'public.pr_retire_policy(uuid, uuid)',
    'public.pr_request_price_change(uuid, uuid, uuid, bigint, text, text)', 'public.pr_review_price_change(uuid, uuid, boolean, text)', 'public.pr_cancel_price_change(uuid, uuid)', 'public.pr_publish_price_change(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

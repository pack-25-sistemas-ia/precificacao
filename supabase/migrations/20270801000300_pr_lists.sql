-- Precificação Inteligente — LISTAS DE PREÇO (parte 4): revisão em rascunho → aprovação → publicação interna, histórico preservado.
-- Publicar uma lista significa disponibilizá-la DENTRO deste sistema; nada é enviado a plataformas externas (D-P11).

begin;
set local check_function_bodies = off;

-- Valida cada preço da versão contra custo vigente, taxas do canal e política: devolve um registro por item com as bandeiras que bloqueiam.
create function private.pr_list_problems(p_org uuid, p_version uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v record; l record; li record; ctx jsonb; chk jsonb; out_ jsonb := '[]'::jsonb; day_ date := private.pr_today(p_org); it record;
begin
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org;
  select * into l from public.price_lists where id = v.price_list_id;
  for li in select * from public.price_list_items where price_list_version_id = p_version order by pricing_item_id, minimum_quantity_decimal nulls first loop
    select i.sku, i.name, i.status, i.archived_at into it from public.pricing_items i where i.id = li.pricing_item_id;
    if it.archived_at is not null or it.status <> 'active' then
      out_ := out_ || jsonb_build_object('item_id', li.pricing_item_id, 'sku', it.sku, 'price_cents', li.price_cents, 'flags', jsonb_build_array('inactive_item'));
      continue;
    end if;
    ctx := private.pr_item_context(p_org, li.pricing_item_id, l.channel_id, coalesce(v.valid_from, day_));
    if ctx -> 'cost' is null or jsonb_typeof(ctx -> 'cost') = 'null' then
      out_ := out_ || jsonb_build_object('item_id', li.pricing_item_id, 'sku', it.sku, 'price_cents', li.price_cents, 'flags', jsonb_build_array('missing_cost'));
      continue;
    end if;
    chk := private.pr_check_price(ctx, li.price_cents);
    out_ := out_ || jsonb_build_object('item_id', li.pricing_item_id, 'sku', it.sku, 'price_cents', li.price_cents, 'flags', chk -> 'flags',
      'margin_pct', chk #> '{evaluation,margin_pct}', 'contribution_cents', chk #> '{evaluation,contribution_cents}');
  end loop;
  return out_;
end $$;
revoke all on function private.pr_list_problems(uuid, uuid) from public, anon, authenticated;

create function public.pr_validate_list_version(p_org uuid, p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'read');
  if not exists (select 1 from public.price_list_versions where id = p_version and organization_id = p_org) then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  return private.pr_list_problems(p_org, p_version);
end $$;

create function public.pr_create_list_version(p_org uuid, p_list uuid, p_valid_from date, p_valid_until date, p_note text default null, p_copy_from uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l record; n integer; id_ uuid;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into l from public.price_lists where id = p_list and organization_id = p_org for update;
  if not found then raise exception 'lista de preços não encontrada' using errcode = 'P0002'; end if;
  if l.status = 'archived' then raise exception 'lista arquivada não recebe nova versão' using errcode = '23514'; end if;
  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then raise exception 'a vigência termina antes de começar' using errcode = '22023'; end if;
  if exists (select 1 from public.price_list_versions where price_list_id = p_list and status in ('draft', 'pending', 'approved')) then
    raise exception 'já existe uma revisão em andamento nesta lista: conclua, retire ou descarte antes de criar outra' using errcode = '23514';
  end if;
  select coalesce(max(version_number), 0) + 1 into n from public.price_list_versions where price_list_id = p_list;
  insert into public.price_list_versions (organization_id, price_list_id, version_number, status, valid_from, valid_until, note, created_by)
  values (p_org, p_list, n, 'draft', p_valid_from, p_valid_until, nullif(trim(p_note), ''), (select auth.uid())) returning id into id_;
  if p_copy_from is not null then
    if not exists (select 1 from public.price_list_versions where id = p_copy_from and price_list_id = p_list) then raise exception 'a versão de origem não pertence a esta lista' using errcode = '22023'; end if;
    insert into public.price_list_items (organization_id, price_list_version_id, pricing_item_id, price_cents, minimum_quantity_decimal, maximum_quantity_decimal, effective_from, effective_until)
    select organization_id, id_, pricing_item_id, price_cents, minimum_quantity_decimal, maximum_quantity_decimal, effective_from, effective_until from public.price_list_items where price_list_version_id = p_copy_from;
  end if;
  perform private.pr_audit(p_org, 'list_version_created', 'price_list_versions', id_, jsonb_build_object('list', p_list, 'version', n));
  return id_;
end $$;

-- Substitui os itens do rascunho (atômico). Cada item: {item_id, price_cents, min_qty?, max_qty?, effective_from?, effective_until?}.
create function public.pr_set_list_items(p_org uuid, p_version uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v record; e jsonb; n integer := 0; pc bigint;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'só rascunhos aceitam alteração de itens (status atual: %)', v.status using errcode = '23514'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then raise exception 'lista de itens inválida (máximo de 1.000)' using errcode = '22023'; end if;
  delete from public.price_list_items where price_list_version_id = p_version;
  for e in select * from jsonb_array_elements(p_items) loop
    begin pc := (e ->> 'price_cents')::bigint; exception when others then raise exception 'preço inválido em um dos itens' using errcode = '22023'; end;
    if pc is null or pc <= 0 then raise exception 'preço inválido em um dos itens' using errcode = '22023'; end if;
    if not exists (select 1 from public.pricing_items i where i.id = (e ->> 'item_id')::uuid and i.organization_id = p_org and i.archived_at is null and i.status = 'active') then
      raise exception 'item inexistente, inativo ou de outra empresa na lista' using errcode = '22023';
    end if;
    insert into public.price_list_items (organization_id, price_list_version_id, pricing_item_id, price_cents, minimum_quantity_decimal, maximum_quantity_decimal, effective_from, effective_until)
    values (p_org, p_version, (e ->> 'item_id')::uuid, pc, nullif(e ->> 'min_qty', '')::numeric, nullif(e ->> 'max_qty', '')::numeric, nullif(e ->> 'effective_from', '')::date, nullif(e ->> 'effective_until', '')::date);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.pr_discard_list_version(p_org uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'só rascunhos podem ser descartados (versões enviadas ou publicadas ficam no histórico)' using errcode = '23514'; end if;
  delete from public.price_list_items where price_list_version_id = p_version;
  delete from public.price_list_versions where id = p_version;
  perform private.pr_audit(p_org, 'list_version_discarded', 'price_list_versions', p_version, jsonb_build_object('list', v.price_list_id, 'version', v.version_number));
end $$;

create function public.pr_submit_list_version(p_org uuid, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; probs jsonb; bad integer;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'só rascunhos podem ser enviados para aprovação' using errcode = '23514'; end if;
  if not exists (select 1 from public.price_list_items where price_list_version_id = p_version) then raise exception 'a lista não tem itens' using errcode = '23514'; end if;
  probs := private.pr_list_problems(p_org, p_version);
  select count(*) into bad from jsonb_array_elements(probs) x where jsonb_array_length(x -> 'flags') > 0;
  if bad > 0 then raise exception '% item(ns) com preço inválido: custo ausente, contribuição negativa ou margem abaixo da mínima — corrija antes de enviar', bad using errcode = '23514'; end if;
  update public.price_list_versions set status = 'pending', submitted_by = (select auth.uid()) where id = p_version;
  perform private.pr_audit(p_org, 'list_submitted', 'price_list_versions', p_version, jsonb_build_object('items', jsonb_array_length(probs)));
  perform private.pr_notify(p_org, 'approval_pending', 'Lista de preços aguardando aprovação', left((select name from public.price_lists where id = v.price_list_id), 200), 'price_list_version', p_version, 'lst:' || p_version::text, array['owner', 'admin', 'manager']::public.org_role[]);
  return probs;
end $$;

create function public.pr_review_list_version(p_org uuid, p_version uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v record; seg boolean;
begin
  perform private.pr_guard(p_org, 'manager');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'a versão não está aguardando aprovação' using errcode = '23514'; end if;
  select segregation_of_duties into seg from public.pr_settings where organization_id = p_org;
  if coalesce(seg, true) and v.submitted_by = (select auth.uid()) then raise exception 'segregação de funções: quem enviou não pode aprovar ou rejeitar a própria lista' using errcode = '42501'; end if;
  if not p_approve and (p_note is null or char_length(trim(p_note)) < 5) then raise exception 'informe o motivo da rejeição (mínimo de 5 caracteres)' using errcode = '22023'; end if;
  update public.price_list_versions set status = case when p_approve then 'approved' else 'rejected' end::public.pr_list_status, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '') where id = p_version;
  perform private.pr_audit(p_org, case when p_approve then 'list_approved' else 'list_rejected' end, 'price_list_versions', p_version, '{}'::jsonb);
  if v.submitted_by is not null then
    perform private.pr_notify_user(p_org, v.submitted_by, case when p_approve then 'price_approved' else 'price_rejected' end, case when p_approve then 'Lista de preços aprovada' else 'Lista de preços rejeitada' end,
      left(coalesce(p_note, ''), 200), 'price_list_version', p_version, 'lrev:' || p_version::text);
  end if;
end $$;

-- Quem enviou pode retirar da fila (volta a rascunho) enquanto estiver pendente ou aprovada e ainda não publicada.
create function public.pr_withdraw_list_version(p_org uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  perform private.pr_guard(p_org, 'analyst');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status not in ('pending', 'approved') then raise exception 'só versões pendentes ou aprovadas e não publicadas podem voltar a rascunho' using errcode = '23514'; end if;
  if v.submitted_by is distinct from (select auth.uid()) and not private.pr_is_manager(p_org) then raise exception 'só quem enviou ou a gestão retira a versão' using errcode = '42501'; end if;
  update public.price_list_versions set status = 'draft', submitted_by = null, reviewed_by = null, reviewed_at = null, review_note = null where id = p_version;
  perform private.pr_audit(p_org, 'list_withdrawn', 'price_list_versions', p_version, '{}'::jsonb);
end $$;

create function public.pr_publish_list_version(p_org uuid, p_version uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v record; l record; probs jsonb; bad integer; li record; prev bigint; n integer := 0; old record;
begin
  perform private.pr_guard(p_org, 'manager');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status = 'published' then raise exception 'versão já publicada' using errcode = '23514'; end if;
  if v.status <> 'approved' then raise exception 'só versões aprovadas podem ser publicadas' using errcode = '23514'; end if;
  select * into l from public.price_lists where id = v.price_list_id for update;
  probs := private.pr_list_problems(p_org, p_version);
  select count(*) into bad from jsonb_array_elements(probs) x where jsonb_array_length(x -> 'flags') > 0;
  if bad > 0 then raise exception 'publicação bloqueada: % item(ns) deixaram de atender às regras com os custos, taxas ou políticas atuais', bad using errcode = '23514'; end if;
  -- a publicação nova aposenta as publicadas que se sobrepõem (o histórico continua consultável)
  for old in select * from public.price_list_versions x where x.price_list_id = v.price_list_id and x.status = 'published' and x.id <> p_version
      and daterange(x.valid_from, x.valid_until, '[]') && daterange(v.valid_from, v.valid_until, '[]') loop
    update public.price_list_versions set status = 'retired' where id = old.id;
  end loop;
  update public.price_list_versions set status = 'published', published_at = now(), published_by = (select auth.uid()) where id = p_version;
  for li in select * from public.price_list_items where price_list_version_id = p_version loop
    select e.new_price_cents into prev from public.price_change_events e join public.price_list_versions pv on pv.id = e.list_version_id
     where pv.price_list_id = v.price_list_id and e.item_id = li.pricing_item_id and e.list_version_id <> p_version order by e.effective_at desc, e.created_at desc limit 1;
    insert into public.price_change_events (organization_id, list_version_id, item_id, channel_id, previous_price_cents, new_price_cents, effective_at, created_by)
    values (p_org, p_version, li.pricing_item_id, l.channel_id, prev, li.price_cents, coalesce(v.valid_from::timestamptz, now()), (select auth.uid()));
    n := n + 1;
  end loop;
  perform private.pr_audit(p_org, 'list_published', 'price_list_versions', p_version, jsonb_build_object('list', v.price_list_id, 'version', v.version_number, 'items', n));
  if v.submitted_by is not null then
    perform private.pr_notify_user(p_org, v.submitted_by, 'price_published', 'Lista de preços publicada', left(l.name, 200), 'price_list_version', p_version, 'lpub:' || p_version::text);
  end if;
  return n;
end $$;

create function public.pr_retire_list_version(p_org uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  perform private.pr_guard(p_org, 'manager');
  select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;
  if not found then raise exception 'versão da lista não encontrada' using errcode = 'P0002'; end if;
  if v.status <> 'published' then raise exception 'só versões publicadas são descontinuadas' using errcode = '23514'; end if;
  update public.price_list_versions set status = 'retired' where id = p_version;
  perform private.pr_audit(p_org, 'list_retired', 'price_list_versions', p_version, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.pr_validate_list_version(uuid, uuid)', 'public.pr_create_list_version(uuid, uuid, date, date, text, uuid)', 'public.pr_set_list_items(uuid, uuid, jsonb)',
    'public.pr_discard_list_version(uuid, uuid)', 'public.pr_submit_list_version(uuid, uuid)', 'public.pr_review_list_version(uuid, uuid, boolean, text)', 'public.pr_withdraw_list_version(uuid, uuid)',
    'public.pr_publish_list_version(uuid, uuid)', 'public.pr_retire_list_version(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

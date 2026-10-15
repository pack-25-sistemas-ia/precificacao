-- Precificação Inteligente — IMPORTAÇÃO CSV (prévia validada no banco → confirmação atômica), vendas observadas e exportação auditada.
-- Importar preço NUNCA publica: cria solicitações pendentes de aprovação (cenário de segurança 10). Importar custo grava o RASCUNHO (não cria versão).

begin;
set local check_function_bodies = off;

create function private.pr_num(p text) returns numeric language plpgsql immutable set search_path = '' as $$
begin if p is null or trim(p) = '' then return null; end if; return p::numeric; exception when others then return null; end $$;

-- Mensagem de erro da linha (ou null se válida). Não grava nada.
create function private.pr_import_check(p_org uuid, p_type text, d jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare it uuid; ch uuid; n numeric; cat uuid; prev bigint;
begin
  if d ? '_parse_error' then return d ->> '_parse_error'; end if;
  if p_type = 'categories' then
    if coalesce(trim(d ->> 'name'), '') = '' then return 'nome obrigatório'; end if;
    if char_length(d ->> 'name') > 80 then return 'nome acima de 80 caracteres'; end if;
    if coalesce(d ->> 'parent', '') <> '' and not exists (select 1 from public.product_categories c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'parent'))) then return 'categoria-pai «' || (d ->> 'parent') || '» não existe (importe-a antes)'; end if;
  elsif p_type = 'items' then
    if coalesce(d ->> 'sku', '') !~ '^[A-Za-z0-9._/-]{1,40}$' then return 'SKU inválido (letras, números e . _ / -, até 40)'; end if;
    if coalesce(trim(d ->> 'name'), '') = '' or char_length(d ->> 'name') > 160 then return 'nome obrigatório (até 160 caracteres)'; end if;
    if coalesce(d ->> 'type', '') not in ('product', 'service') then return 'tipo deve ser produto ou serviço'; end if;
    if coalesce(trim(d ->> 'unit'), '') = '' or char_length(d ->> 'unit') > 12 then return 'unidade obrigatória (até 12 caracteres)'; end if;
    if coalesce(d ->> 'category', '') <> '' and not exists (select 1 from public.product_categories c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'category'))) then return 'categoria «' || (d ->> 'category') || '» não existe'; end if;
  elsif p_type = 'costs' then
    select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku') and i.archived_at is null;
    if it is null then return 'SKU «' || coalesce(d ->> 'sku', '') || '» não cadastrado'; end if;
    if coalesce(trim(d ->> 'name'), '') = '' then return 'nome do componente obrigatório'; end if;
    if coalesce(d ->> 'cost_class', 'direct') not in ('direct', 'overhead') then return 'classe deve ser direto ou rateio'; end if;
    if coalesce(d ->> 'cost_class', 'direct') = 'direct' and coalesce(d ->> 'cost_type', '') not in ('acquisition', 'raw_material', 'direct_labor', 'packaging', 'acquisition_freight', 'supply', 'outsourced_service', 'other_direct') then return 'tipo de custo direto inválido'; end if;
    if coalesce(d ->> 'cost_class', 'direct') = 'overhead' and coalesce(d ->> 'allocation_method', '') not in ('volume', 'services', 'hours', 'percent', 'manual') then return 'método de rateio inválido'; end if;
    if coalesce(d ->> 'amount', '') <> '' then n := private.pr_num(d ->> 'amount'); if n is null or n < 0 then return 'valor inválido'; end if; end if;
    n := coalesce(private.pr_num(nullif(d ->> 'quantity', '')), 1); if n <= 0 then return 'quantidade deve ser maior que zero'; end if;
    n := coalesce(private.pr_num(nullif(d ->> 'usage', '')), 1); if n <= 0 then return 'consumo deve ser maior que zero'; end if;
  elsif p_type = 'prices' then
    select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku') and i.archived_at is null and i.status = 'active';
    if it is null then return 'SKU «' || coalesce(d ->> 'sku', '') || '» não cadastrado ou inativo'; end if;
    if coalesce(d ->> 'channel', '') <> '' then
      select c.id into ch from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel')) and c.active;
      if ch is null then return 'canal «' || (d ->> 'channel') || '» não existe ou está inativo'; end if;
    end if;
    n := private.pr_num(d ->> 'price');
    if n is null or n <= 0 or n <> trunc(n) then return 'preço inválido (centavos inteiros e maior que zero)'; end if;
    if not exists (select 1 from public.cost_model_versions v where v.item_id = it) then return 'item sem versão de custo: salve o custo antes de propor preço'; end if;
    if exists (select 1 from public.price_change_requests r where r.item_id = it and r.organization_id = p_org and r.status in ('pending', 'approved') and r.channel_id is not distinct from ch) then return 'já existe proposta em andamento para este item e canal'; end if;
  elsif p_type = 'fees' then
    select c.id into ch from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel'));
    if ch is null then return 'canal «' || coalesce(d ->> 'channel', '') || '» não existe'; end if;
    if coalesce(trim(d ->> 'name'), '') = '' then return 'nome da taxa obrigatório'; end if;
    if coalesce(d ->> 'kind', '') not in ('commission', 'payment', 'platform', 'shipping_subsidy', 'transaction', 'tax', 'other') then return 'tipo de taxa inválido'; end if;
    if coalesce(d ->> 'basis', '') not in ('price', 'net_price', 'cost', 'fixed_unit', 'fixed_transaction') then return 'base de incidência inválida'; end if;
    if (d ->> 'basis') in ('price', 'net_price', 'cost') then
      n := private.pr_num(d ->> 'rate'); if n is null or n < 0 or n > 100 then return 'percentual inválido (0 a 100)'; end if;
    else n := private.pr_num(d ->> 'fixed'); if n is null or n < 0 then return 'valor fixo inválido'; end if; end if;
  elsif p_type = 'sales' then
    select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku');
    if it is null then return 'SKU «' || coalesce(d ->> 'sku', '') || '» não cadastrado'; end if;
    if coalesce(d ->> 'channel', '') <> '' and not exists (select 1 from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel'))) then return 'canal «' || (d ->> 'channel') || '» não existe'; end if;
    begin if (d ->> 'date')::date > current_date + 1 then return 'data no futuro'; end if; exception when others then return 'data inválida (use AAAA-MM-DD)'; end;
    n := private.pr_num(d ->> 'quantity'); if n is null or n <= 0 then return 'quantidade inválida'; end if;
    n := private.pr_num(d ->> 'gross'); if n is null or n < 0 or n <> trunc(n) then return 'receita inválida (centavos inteiros)'; end if;
    n := coalesce(private.pr_num(nullif(d ->> 'discount', '')), 0); if n < 0 or n <> trunc(n) or n > private.pr_num(d ->> 'gross') then return 'desconto inválido'; end if;
    n := coalesce(private.pr_num(nullif(d ->> 'fees', '')), 0); if n < 0 or n <> trunc(n) then return 'taxas inválidas'; end if;
  else return 'tipo de importação inválido';
  end if;
  return null;
end $$;
revoke all on function private.pr_num(text) from public, anon, authenticated;
revoke all on function private.pr_import_check(uuid, text, jsonb) from public, anon, authenticated;

create function private.pr_import_level(p_type text) returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('items', 'costs', 'prices') then 'analyst' else 'manager' end $$;

-- Duplicidade semântica (a linha já está aplicada ou repete outra do arquivo).
create function private.pr_import_is_duplicate(p_org uuid, p_type text, d jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if p_type = 'categories' then
    return exists (select 1 from public.product_categories c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'name'))
      and c.parent_id is not distinct from (select p.id from public.product_categories p where p.organization_id = p_org and lower(trim(p.name)) = lower(trim(d ->> 'parent')) limit 1));
  elsif p_type = 'items' then return exists (select 1 from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku'));
  elsif p_type = 'fees' then return exists (select 1 from public.channel_fee_rules f join public.sales_channels c on c.id = f.channel_id where f.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel')) and lower(trim(f.name)) = lower(trim(d ->> 'name')));
  elsif p_type = 'sales' then return coalesce(d ->> 'reference', '') <> '' and exists (select 1 from public.sales_observations s where s.organization_id = p_org and s.external_reference = d ->> 'reference');
  elsif p_type = 'prices' then
    return exists (select 1 from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku') and
      coalesce((select icp.price_cents from public.item_channel_prices icp join public.sales_channels c on c.id = icp.channel_id where icp.item_id = i.id and lower(trim(c.name)) = lower(trim(d ->> 'channel'))), case when coalesce(d ->> 'channel', '') = '' then i.current_base_price_cents end) = (d ->> 'price')::bigint);
  end if;
  return false;
end $$;
revoke all on function private.pr_import_level(text) from public, anon, authenticated;
revoke all on function private.pr_import_is_duplicate(uuid, text, jsonb) from public, anon, authenticated;

create function public.pr_create_import(p_org uuid, p_type text, p_file_name text, p_hash text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job uuid; e jsonb; i integer := 0; err text; st text; valid_n integer := 0; err_n integer := 0; dup_n integer := 0; seen text[] := '{}'; key_ text; exist uuid;
begin
  perform private.pr_guard(p_org, private.pr_import_level(p_type));
  if p_type not in ('categories', 'items', 'costs', 'prices', 'fees', 'sales') then raise exception 'tipo de importação inválido' using errcode = '22023'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'hash do arquivo inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then raise exception 'o arquivo precisa ter de 1 a 5.000 linhas' using errcode = '22023'; end if;
  select id into exist from public.import_jobs where organization_id = p_org and import_type = p_type and file_hash = p_hash and status in ('previewed', 'completed');
  if exist is not null then return jsonb_build_object('duplicate_file', true, 'import_id', exist); end if;
  insert into public.import_jobs (organization_id, file_name, file_hash, import_type, total_rows, created_by) values (p_org, left(coalesce(p_file_name, 'arquivo.csv'), 200), p_hash, p_type, jsonb_array_length(p_rows), (select auth.uid())) returning id into job;
  for e in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    err := private.pr_import_check(p_org, p_type, e);
    st := 'valid';
    if err is null then
      key_ := p_type || '|' || case p_type when 'categories' then lower(trim(e ->> 'name')) || '|' || lower(trim(coalesce(e ->> 'parent', ''))) when 'items' then lower(e ->> 'sku')
        when 'costs' then lower(e ->> 'sku') || '|' || lower(trim(e ->> 'name')) when 'prices' then lower(e ->> 'sku') || '|' || lower(trim(coalesce(e ->> 'channel', '')))
        when 'fees' then lower(trim(e ->> 'channel')) || '|' || lower(trim(e ->> 'name')) else coalesce(nullif(e ->> 'reference', ''), 'linha-' || i::text) end;
      if key_ = any (seen) or private.pr_import_is_duplicate(p_org, p_type, e) then st := 'duplicate'; dup_n := dup_n + 1; err := 'repetida (já existe ou aparece antes no arquivo)'; else seen := seen || key_; valid_n := valid_n + 1; end if;
    else st := 'error'; err_n := err_n + 1; end if;
    insert into public.import_rows (organization_id, import_job_id, row_number, data, status, error_code, error_message) values (p_org, job, i + 1, e - '_parse_error', st, case st when 'valid' then null else st end, left(err, 300));
  end loop;
  update public.import_jobs set failed_rows = err_n, duplicate_rows = dup_n where id = job;
  return jsonb_build_object('import_id', job, 'total', i, 'valid', valid_n, 'errors', err_n, 'duplicates', dup_n);
end $$;

create function public.pr_cancel_import(p_org uuid, p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if not found then raise exception 'importação não encontrada' using errcode = 'P0002'; end if;
  perform private.pr_guard(p_org, private.pr_import_level(j.import_type));
  if j.status <> 'previewed' then raise exception 'só prévias podem ser canceladas' using errcode = '23514'; end if;
  update public.import_jobs set status = 'cancelled', completed_at = now() where id = p_job;
end $$;

create function public.pr_commit_import(p_org uuid, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record; r record; d jsonb; n integer := 0; it uuid; ch uuid; cat uuid; amt numeric; pid uuid;
begin
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if not found then raise exception 'importação não encontrada' using errcode = 'P0002'; end if;
  perform private.pr_guard(p_org, private.pr_import_level(j.import_type));
  if j.status = 'completed' then return jsonb_build_object('already', true, 'applied', j.successful_rows); end if;
  if j.status <> 'previewed' then raise exception 'importação não está pronta para confirmação' using errcode = '23514'; end if;
  for r in select * from public.import_rows where import_job_id = p_job and status = 'valid' order by row_number loop
    d := r.data;
    if j.import_type = 'categories' then
      select c.id into cat from public.product_categories c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'parent')) limit 1;
      insert into public.product_categories (organization_id, name, parent_id) values (p_org, trim(d ->> 'name'), cat);
    elsif j.import_type = 'items' then
      select c.id into cat from public.product_categories c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'category')) limit 1;
      insert into public.pricing_items (organization_id, category_id, item_type, sku, name, description, unit) values (p_org, cat, (d ->> 'type')::public.pr_item_type, d ->> 'sku', trim(d ->> 'name'), nullif(d ->> 'description', ''), trim(d ->> 'unit'));
    elsif j.import_type = 'costs' then
      select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku');
      amt := private.pr_num(nullif(d ->> 'amount', ''));
      update public.cost_components set amount_cents = amt, quantity = coalesce(private.pr_num(nullif(d ->> 'quantity', '')), 1), usage = coalesce(private.pr_num(nullif(d ->> 'usage', '')), 1), active = true
       where item_id = it and lower(trim(name)) = lower(trim(d ->> 'name')) and cost_class = coalesce(d ->> 'cost_class', 'direct')::public.pr_cost_class returning id into pid;
      if pid is null then
        insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity, usage, allocation_method)
        values (p_org, it, coalesce(d ->> 'cost_class', 'direct')::public.pr_cost_class, case when coalesce(d ->> 'cost_class', 'direct') = 'overhead' then 'allocated_overhead' else d ->> 'cost_type' end::public.pr_cost_type, trim(d ->> 'name'), amt,
          coalesce(private.pr_num(nullif(d ->> 'quantity', '')), 1), coalesce(private.pr_num(nullif(d ->> 'usage', '')), 1), case when coalesce(d ->> 'cost_class', 'direct') = 'overhead' then (d ->> 'allocation_method')::public.pr_alloc_method end);
      end if;
      pid := null;
    elsif j.import_type = 'prices' then
      select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku');
      select c.id into ch from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel'));
      perform public.pr_request_price_change(p_org, it, ch, (d ->> 'price')::bigint, 'Importado de ' || left(j.file_name, 80) || ' (linha ' || r.row_number::text || ')', 'import');
    elsif j.import_type = 'fees' then
      select c.id into ch from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel'));
      insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, minimum_amount_cents, maximum_amount_cents)
      values (p_org, ch, trim(d ->> 'name'), (d ->> 'kind')::public.pr_fee_kind, (d ->> 'basis')::public.pr_fee_basis,
        case when (d ->> 'basis') in ('price', 'net_price', 'cost') then private.pr_num(d ->> 'rate') end, case when (d ->> 'basis') in ('fixed_unit', 'fixed_transaction') then private.pr_num(d ->> 'fixed') end,
        case when (d ->> 'basis') in ('price', 'net_price', 'cost') then private.pr_num(nullif(d ->> 'min', '')) end, case when (d ->> 'basis') in ('price', 'net_price', 'cost') then private.pr_num(nullif(d ->> 'max', '')) end);
    else
      select i.id into it from public.pricing_items i where i.organization_id = p_org and lower(i.sku) = lower(d ->> 'sku');
      select c.id into ch from public.sales_channels c where c.organization_id = p_org and lower(trim(c.name)) = lower(trim(d ->> 'channel'));
      insert into public.sales_observations (organization_id, item_id, channel_id, source, external_reference, quantity_decimal, gross_revenue_cents, discounts_cents, fees_cents, observed_at, import_job_id)
      values (p_org, it, ch, 'import', nullif(d ->> 'reference', ''), private.pr_num(d ->> 'quantity'), (d ->> 'gross')::bigint, coalesce(private.pr_num(nullif(d ->> 'discount', '')), 0)::bigint,
        coalesce(private.pr_num(nullif(d ->> 'fees', '')), 0)::bigint, (d ->> 'date')::date, p_job);
    end if;
    update public.import_rows set status = 'applied' where id = r.id;
    n := n + 1;
  end loop;
  update public.import_jobs set status = 'completed', successful_rows = n, completed_at = now() where id = p_job;
  perform private.pr_audit(p_org, 'import_completed', 'import_jobs', p_job, jsonb_build_object('type', j.import_type, 'rows', n));
  perform private.pr_notify_user(p_org, j.created_by, 'import_done', 'Importação concluída', n::text || ' linha(s) aplicada(s)', 'import_job', p_job, 'imp:' || p_job::text);
  return jsonb_build_object('applied', n);
end $$;

-- ======================================================================= vendas observadas: indicadores ponderados (só com dados reais importados)
-- Margem ponderada = Σ contribuição estimada ÷ Σ receita líquida, só das vendas COM custo vigente na data (as demais são contadas como não elegíveis).
create function public.pr_sales_summary(p_org uuid, p_from date, p_to date, p_channel uuid default null, p_category uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  perform private.pr_guard(p_org, 'read');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1830 then raise exception 'período inválido' using errcode = '22023'; end if;
  with obs as (
    select s.*, i.sku, i.name, i.category_id,
      (select cm.direct_unit_cost_cents from public.cost_model_versions cm where cm.item_id = s.item_id and cm.created_at < (s.observed_at + 1)::timestamptz order by cm.version_number desc limit 1) as unit_cost
    from public.sales_observations s join public.pricing_items i on i.id = s.item_id
    where s.organization_id = p_org and s.observed_at between p_from and p_to and (p_channel is null or s.channel_id = p_channel) and (p_category is null or i.category_id = p_category)
  ), calc as (
    select *, gross_revenue_cents - discounts_cents as net, case when unit_cost is null then null else gross_revenue_cents - discounts_cents - round(unit_cost * quantity_decimal) - fees_cents end as contrib from obs
  )
  select jsonb_build_object(
    'observations', count(*), 'eligible', count(*) filter (where contrib is not null), 'ineligible', count(*) filter (where contrib is null),
    'quantity', coalesce(sum(quantity_decimal), 0), 'gross_cents', coalesce(sum(gross_revenue_cents), 0), 'discounts_cents', coalesce(sum(discounts_cents), 0), 'net_cents', coalesce(sum(net), 0),
    'average_price_cents', case when sum(quantity_decimal) > 0 then round(sum(net) / sum(quantity_decimal)) end,
    'average_discount_pct', case when sum(gross_revenue_cents) > 0 then round(sum(discounts_cents)::numeric / sum(gross_revenue_cents) * 100, 4) end,
    'eligible_net_cents', coalesce(sum(net) filter (where contrib is not null), 0), 'contribution_cents', coalesce(sum(contrib), 0),
    'weighted_margin_pct', case when coalesce(sum(net) filter (where contrib is not null), 0) > 0 then round(sum(contrib)::numeric / (sum(net) filter (where contrib is not null)) * 100, 4) end) into res from calc;
  return res;
end $$;

-- Exportação de relatórios (auditada: quem, qual relatório, quantas linhas — nunca valores).
create function public.pr_log_export(p_org uuid, p_report text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pr_guard(p_org, 'manager');
  if p_report is null or p_report !~ '^[a-z_]{3,40}$' then raise exception 'relatório inválido' using errcode = '22023'; end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes)
  values (p_org, (select auth.uid()), 'export', p_report, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.pr_create_import(uuid, text, text, text, jsonb)', 'public.pr_cancel_import(uuid, uuid)', 'public.pr_commit_import(uuid, uuid)', 'public.pr_sales_summary(uuid, date, date, uuid, uuid)', 'public.pr_log_export(uuid, text, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

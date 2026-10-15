-- Importação CSV (prévia validada no banco → confirmação atômica), preços importados NUNCA publicam, vendas observadas (margem PONDERADA × média simples) e exportação auditada.
--  P1: custo 2200, canal Marketplace com comissão 15 %.
--  Vendas observadas em P1: (a) 10 un., bruto 30000, desconto 3000, taxas 4050 → líquido 27000, custo 22000, contribuição 950; (b) 5 un., bruto 15000, taxas 2250 → líquido 15000, custo 11000, contribuição 1750.
--  Ponderada = (950 + 1750) ÷ (27000 + 15000) = 2700 ÷ 42000 = 6,4286 %  (a média simples das margens, 3,5185 % e 11,6667 %, daria 7,5926 % — outro número, de propósito).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.h(s text) returns text language sql as $$ select encode(sha256(convert_to(s, 'utf8')), 'hex') $$;
create function test.js(variadic r jsonb[]) returns jsonb language sql as $$ select to_jsonb(r) $$;
create function test.kv(variadic kv text[]) returns jsonb language plpgsql as $$
declare o jsonb := '{}'; i integer;
begin for i in 1 .. cardinality(kv) / 2 loop o := o || jsonb_build_object(kv[2 * i - 1], kv[2 * i]); end loop; return o; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; ch uuid; p1 uuid; p2 uuid;
begin
  org := public.create_organization('Importações PR', 'importacoes-pr');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  insert into public.sales_channels (organization_id, name, channel_type) values (org, 'Marketplace', 'marketplace') returning id into ch;
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal) values (org, ch, 'Comissão', 'commission', 'price', 15);
  insert into public.pricing_items (organization_id, item_type, sku, name) values (org, 'product', 'P1', 'Produto 1') returning id into p1;
  insert into public.pricing_items (organization_id, item_type, sku, name) values (org, 'product', 'P2', 'Sem custo') returning id into p2;
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity) values (org, p1, 'direct', 'acquisition', 'Compra', 200000, 100);
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents) values (org, p1, 'direct', 'packaging', 'Embalagem', 200);
  perform public.pr_save_cost_version(org, p1, null);
  perform set_config('t.ch', ch::text, true); perform set_config('t.p1', p1::text, true); perform set_config('t.p2', p2::text, true);
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b-im')::text, true); end $$;
reset role;

-- ===================================================================== categorias (gestor) e itens (analista)
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'categories', 'c.csv', %L, %L::jsonb)$q$, org, test.h('x'), test.js(test.kv('name', 'A')))) like '%sem permissão%', 'analista não importa categorias';
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'fees', 'f.csv', %L, %L::jsonb)$q$, org, test.h('x'), test.js(test.kv('channel', 'Marketplace')))) like '%sem permissão%', 'analista não importa taxas';
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'sales', 'v.csv', %L, %L::jsonb)$q$, org, test.h('x'), test.js(test.kv('sku', 'P1')))) like '%sem permissão%', 'analista não importa vendas';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb; j uuid;
begin
  r := public.pr_create_import(org, 'categories', 'categorias.csv', test.h('cat-1'), test.js(test.kv('name', 'Eletrônicos'), test.kv('name', 'Cabos', 'parent', 'Eletrônicos'), test.kv('name', 'eletrônicos')));
  assert (r ->> 'total')::int = 3 and (r ->> 'valid')::int = 1 and (r ->> 'errors')::int = 1 and (r ->> 'duplicates')::int = 1, 'prévia: 1 válida (Eletrônicos), 1 erro (pai ainda não existe), 1 repetida no arquivo';
  assert (select error_message from public.import_rows where import_job_id = (r ->> 'import_id')::uuid and row_number = 3) like '%categoria-pai%não existe%', 'o erro explica a causa';
  assert (select count(*) from public.product_categories) = 0, 'a prévia não grava nada';
  j := (r ->> 'import_id')::uuid;
  r := public.pr_commit_import(org, j);
  assert (r ->> 'applied')::int = 1 and (select count(*) from public.product_categories) = 1, 'confirmação cria 1 categoria';
  assert public.pr_commit_import(org, j) -> 'already' = 'true'::jsonb and (select count(*) from public.product_categories) = 1, 'confirmar de novo não duplica';
  assert (public.pr_create_import(org, 'categories', 'categorias.csv', test.h('cat-1'), test.js(test.kv('name', 'Outra'))) ->> 'duplicate_file')::boolean, 'o mesmo arquivo não é importado duas vezes';
  r := public.pr_create_import(org, 'categories', 'cabos.csv', test.h('cat-2'), test.js(test.kv('name', 'Cabos', 'parent', 'Eletrônicos')));
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  assert (select parent_id is not null from public.product_categories where name = 'Cabos'), 'com o pai já existente a subcategoria entra ligada';
  -- cancelar prévia libera o arquivo para nova tentativa
  r := public.pr_create_import(org, 'categories', 'x.csv', test.h('cat-3'), test.js(test.kv('name', 'Cancelada')));
  perform public.pr_cancel_import(org, (r ->> 'import_id')::uuid);
  assert (select status from public.import_jobs where id = (r ->> 'import_id')::uuid) = 'cancelled' and (select count(*) from public.product_categories) = 2, 'prévia cancelada não grava';
  assert not coalesce((public.pr_create_import(org, 'categories', 'x.csv', test.h('cat-3'), test.js(test.kv('name', 'Cancelada'))) ->> 'duplicate_file')::boolean, false), 'arquivo de prévia cancelada pode ser enviado de novo';
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'categories', 'v.csv', 'abc', '[{"name":"x"}]'::jsonb)$q$, org)) like '%hash%', 'hash inválido recusado';
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'categories', 'v.csv', %L, '[]'::jsonb)$q$, org, test.h('vazio'))) like '%1 a 5.000 linhas%', 'arquivo vazio recusado';
  raise notice 'PASS: importação de categorias — prévia, erros, repetidas, atomicidade e hash';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.pr_create_import(org, 'items', 'itens.csv', test.h('it-1'), test.js(
    test.kv('sku', 'N1', 'name', 'Novo produto', 'type', 'product', 'unit', 'un', 'category', 'Cabos'),
    test.kv('sku', 'N2', 'name', 'Consultoria', 'type', 'service', 'unit', 'h'),
    test.kv('sku', 'p1', 'name', 'Repetido', 'type', 'product', 'unit', 'un'),
    test.kv('sku', 'N 3', 'name', 'SKU inválido', 'type', 'product', 'unit', 'un'),
    test.kv('sku', 'N4', 'name', 'Tipo inválido', 'type', 'banana', 'unit', 'un'),
    test.kv('sku', 'N5', 'name', 'Categoria inexistente', 'type', 'product', 'unit', 'un', 'category', 'Nada')));
  assert (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 3, 'itens: 2 válidos, 1 repetido (SKU existente), 3 com erro';
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  assert (select count(*) from public.pricing_items where sku in ('N1', 'N2')) = 2 and (select item_type from public.pricing_items where sku = 'N2') = 'service', 'serviço e produto criados';
  assert (select category_id is not null from public.pricing_items where sku = 'N1'), 'categoria ligada pelo nome';
  -- custos: valor vazio = DESCONHECIDO (não zero)
  r := public.pr_create_import(org, 'costs', 'custos.csv', test.h('co-1'), test.js(
    test.kv('sku', 'N1', 'name', 'Compra', 'cost_type', 'acquisition', 'amount', '5000'),
    test.kv('sku', 'N1', 'name', 'Frete', 'cost_type', 'acquisition_freight', 'amount', ''),
    test.kv('sku', 'N2', 'name', 'Hora técnica', 'cost_type', 'direct_labor', 'amount', '8000', 'usage', '2.5'),
    test.kv('sku', 'NAO', 'name', 'x', 'cost_type', 'acquisition', 'amount', '1'),
    test.kv('sku', 'N1', 'name', 'Neg', 'cost_type', 'acquisition', 'amount', '-5')));
  assert (r ->> 'valid')::int = 3 and (r ->> 'errors')::int = 2, 'custos: 3 válidos, 2 com erro (SKU inexistente, valor negativo)';
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  assert (select amount_cents is null from public.cost_components c join public.pricing_items i on i.id = c.item_id where i.sku = 'N1' and c.name = 'Frete'), 'valor vazio ficou desconhecido (null), não zero';
  assert (select count(*) from public.cost_model_versions v join public.pricing_items i on i.id = v.item_id where i.sku = 'N1') = 0, 'importar custo grava o rascunho; não cria versão sozinho';
  raise notice 'PASS: importação de itens e custos — desconhecido ≠ zero, rascunho sem versão';
end $$;
reset role;

-- ===================================================================== preços importados NÃO publicam (viram solicitações pendentes)
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; req uuid;
begin
  r := public.pr_create_import(org, 'prices', 'precos.csv', test.h('pr-1'), test.js(
    test.kv('sku', 'P1', 'channel', 'Marketplace', 'price', '3000'),
    test.kv('sku', 'N1', 'channel', 'Marketplace', 'price', '1000'),
    test.kv('sku', 'ZZ', 'channel', 'Marketplace', 'price', '1000'),
    test.kv('sku', 'P1', 'channel', 'Inexistente', 'price', '1000'),
    test.kv('sku', 'P1', 'price', '0')));
  assert (r ->> 'valid')::int = 1 and (r ->> 'errors')::int = 4, 'preços: 1 válido; erros: item sem versão de custo, SKU inexistente, canal inexistente, preço zero';
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  select id into req from public.price_change_requests where item_id = test.t('p1');
  assert (select status from public.price_change_requests where id = req) = 'pending' and (select source from public.price_change_requests where id = req) = 'import', 'o preço importado virou solicitação PENDENTE (origem importação)';
  assert not exists (select 1 from public.item_channel_prices) and (select current_base_price_cents is null from public.pricing_items where id = test.t('p1')), 'nenhum preço foi publicado pela importação';
  assert (select count(*) from public.price_change_events) = 0, 'nenhum evento de preço publicado';
  r := public.pr_create_import(org, 'prices', 'precos2.csv', test.h('pr-2'), test.js(test.kv('sku', 'P1', 'channel', 'Marketplace', 'price', '3100')));
  assert (r ->> 'errors')::int = 1 and (select error_message from public.import_rows where import_job_id = (r ->> 'import_id')::uuid) like '%já existe proposta em andamento%', 'segunda importação para o mesmo item e canal: recusada enquanto houver proposta em andamento';
end $$;
reset role;

-- ===================================================================== taxas e vendas observadas (gestor)
:as_ma
do $$
declare org uuid := test.t('org'); r jsonb; s jsonb;
begin
  r := public.pr_create_import(org, 'fees', 'taxas.csv', test.h('fe-1'), test.js(
    test.kv('channel', 'Marketplace', 'name', 'Tarifa fixa', 'kind', 'transaction', 'basis', 'fixed_unit', 'fixed', '100'),
    test.kv('channel', 'Marketplace', 'name', 'comissão', 'kind', 'commission', 'basis', 'price', 'rate', '15'),
    test.kv('channel', 'Marketplace', 'name', 'Taxa absurda', 'kind', 'other', 'basis', 'price', 'rate', '150'),
    test.kv('channel', 'Outro', 'name', 'x', 'kind', 'other', 'basis', 'price', 'rate', '1'),
    test.kv('channel', 'Marketplace', 'name', 'Teto', 'kind', 'platform', 'basis', 'net_price', 'rate', '2', 'max', '300')));
  assert (r ->> 'valid')::int = 2 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 2, 'taxas: 2 válidas, 1 repetida (comissão já existe), 2 com erro (percentual > 100, canal inexistente)';
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  assert (select count(*) from public.channel_fee_rules where name in ('Tarifa fixa', 'Teto')) = 2 and (select maximum_amount_cents from public.channel_fee_rules where name = 'Teto') = 300, 'taxas criadas (fixa e com teto)';
  update public.channel_fee_rules set active = false where name in ('Tarifa fixa', 'Teto');
  r := public.pr_create_import(org, 'sales', 'vendas.csv', test.h('ve-1'), test.js(
    test.kv('sku', 'P1', 'channel', 'Marketplace', 'date', current_date::text, 'quantity', '10', 'gross', '30000', 'discount', '3000', 'fees', '4050', 'reference', 'PED-1'),
    test.kv('sku', 'P1', 'channel', 'Marketplace', 'date', current_date::text, 'quantity', '5', 'gross', '15000', 'fees', '2250', 'reference', 'PED-2'),
    test.kv('sku', 'P2', 'date', current_date::text, 'quantity', '1', 'gross', '1000', 'reference', 'PED-3'),
    test.kv('sku', 'P1', 'date', current_date::text, 'quantity', '1', 'gross', '1000', 'reference', 'PED-1'),
    test.kv('sku', 'P1', 'date', '2999-01-01', 'quantity', '1', 'gross', '1000'),
    test.kv('sku', 'P1', 'date', current_date::text, 'quantity', '1', 'gross', '1000', 'discount', '2000')));
  assert (r ->> 'valid')::int = 3 and (r ->> 'duplicates')::int = 1 and (r ->> 'errors')::int = 2, 'vendas: 3 válidas, 1 referência repetida, 2 erros (data futura, desconto > receita)';
  perform public.pr_commit_import(org, (r ->> 'import_id')::uuid);
  s := public.pr_sales_summary(org, current_date - 30, current_date);
  assert (s ->> 'observations')::int = 3 and (s ->> 'eligible')::int = 2 and (s ->> 'ineligible')::int = 1, 'resumo: 3 vendas, 2 elegíveis, 1 sem custo (P2 não tem versão de custo)';
  assert (s ->> 'quantity')::numeric = 16 and (s ->> 'gross_cents')::int = 46000 and (s ->> 'discounts_cents')::int = 3000 and (s ->> 'net_cents')::int = 43000, 'quantidade 16, bruto 46000, descontos 3000, líquido 43000';
  assert (s ->> 'eligible_net_cents')::int = 42000 and (s ->> 'contribution_cents')::int = 2700, 'base elegível 42000 e contribuição 2700';
  assert (s ->> 'weighted_margin_pct') = '6.4286', 'margem PONDERADA = 2700 ÷ 42000 = 6,4286 % (não a média simples 7,59 %)';
  assert (s ->> 'average_price_cents')::int = 2688 and (s ->> 'average_discount_pct') = '6.5217', 'preço médio praticado 2688 e desconto médio 6,5217 %';
  assert public.pr_sales_summary(org, current_date + 1, current_date + 5) ->> 'weighted_margin_pct' is null and (public.pr_sales_summary(org, current_date + 1, current_date + 5) ->> 'observations')::int = 0, 'sem vendas no período: margem ponderada indisponível (null), nada inventado';
  assert test.errmsg(format($q$select public.pr_sales_summary(%L, current_date, current_date - 1)$q$, org)) like '%período inválido%', 'período invertido recusado';
  assert test.errmsg(format($q$update public.sales_observations set quantity_decimal = 99$q$)) like '%permission denied%', 'venda observada não é editável pelo usuário';
  raise notice 'PASS: taxas e vendas observadas — margem ponderada, elegibilidade e dados reais';
end $$;
reset role;
do $$
begin
  assert test.errmsg('update public.sales_observations set quantity_decimal = 99') like '%imutável%', 'gatilho: venda observada imutável até para o dono do schema';
  assert test.errmsg('delete from public.sales_observations') like '%não pode ser apagado%', 'gatilho: venda observada não é apagada';
end $$;

-- ===================================================================== exportação auditada, permissões e isolamento
:as_na
do $$
begin
  assert test.errmsg(format($q$select public.pr_log_export(%L, 'precos_atuais', 3)$q$, test.t('org'))) like '%sem permissão%', 'analista não exporta';
end $$;
reset role;
:as_ma
do $$
begin
  perform public.pr_log_export(test.t('org'), 'precos_atuais', 42);
  assert test.errmsg(format($q$select public.pr_log_export(%L, 'Nome Inválido!', 1)$q$, test.t('org'))) like '%relatório inválido%', 'nome de relatório validado';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.audit_log where action = 'export') = 1 and (select changes ->> 'rows' from public.audit_log where action = 'export') = '42', 'exportação registrada com o número de linhas';
  assert (select count(*) from public.audit_log where action = 'export' and changes::text ~ '[0-9]{5,}') = 0, 'nenhum valor na trilha de exportação';
end $$;
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.import_jobs) >= 6 and (select count(*) from public.sales_observations) = 3, 'consulta lê importações e vendas';
  assert test.errmsg(format($q$select public.pr_create_import(%L, 'items', 'v.csv', %L, '[{"sku":"V1"}]'::jsonb)$q$, org, test.h('viewer'))) like '%sem permissão%', 'consulta não importa';
  assert (public.pr_sales_summary(org, current_date - 30, current_date) ->> 'observations')::int = 3, 'consulta lê o resumo de vendas';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org'); j uuid;
begin
  select id into j from public.import_jobs limit 1;
  assert (select count(*) from public.import_jobs) = 0 and (select count(*) from public.import_rows) = 0 and (select count(*) from public.sales_observations) = 0, 'empresa B não enxerga importações nem vendas da A';
  assert test.errmsg(format($q$select public.pr_sales_summary(%L, current_date - 30, current_date)$q$, org)) like '%sem permissão%', 'empresa B não lê vendas da A';
  assert test.errmsg(format($q$select public.pr_commit_import(%L, %L)$q$, test.t('orgb'), test.t('p1'))) like '%não encontrada%', 'ID de importação inexistente na empresa B: não encontrada';
end $$;
reset role;

rollback;
select 'PASS 83_pr_import_sales' as result;

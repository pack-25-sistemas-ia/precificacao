-- Listas de preço versionadas (rascunho → aprovação → publicação, vigência, faixas de quantidade, imutabilidade) e cenários (snapshots, recálculo no banco, verificação de sugestão).
--  Item P1: custo direto 2200 (compra 20,00 + embalagem 2,00). Canal «Marketplace»: comissão 15 % sobre o preço. Sem políticas: padrão da empresa (meta 30 %, mínima 10 %).
--  Preço 3000 → taxa 450, contribuição 350 (11,67 %) · 2700 → taxa 405, contribuição 95 · 4000 → taxa 600, contribuição 1200 (30 % exatos) · 3900 → taxa 585, contribuição 1115 (28,6 %).
--  Custo +10 % = 2420: com preço 3000, contribuição = 3000 − 2420 − 450 = 130.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.items(variadic r jsonb[]) returns jsonb language sql as $$ select to_jsonb(r) $$;
create function test.it(item uuid, price bigint, mn numeric default null, mx numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('item_id', item, 'price_cents', price, 'min_qty', mn, 'max_qty', mx)) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; ch uuid; p1 uuid; p2 uuid;
begin
  org := public.create_organization('Listas e cenários', 'listas-cenarios');
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
  insert into public.price_lists (organization_id, name, channel_id) values (org, 'Tabela Marketplace', ch);
  perform set_config('t.pl', (select id::text from public.price_lists where organization_id = org), true);
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b-ls')::text, true); end $$;
reset role;

-- ===================================================================== listas de preço
:as_na
do $$
declare org uuid := test.t('org'); pl uuid := test.t('pl'); v uuid; n integer; probs jsonb;
begin
  v := public.pr_create_list_version(org, pl, current_date, null, 'primeira revisão');
  perform set_config('t.lv1', v::text, true);
  assert (select version_number from public.price_list_versions where id = v) = 1 and (select status from public.price_list_versions where id = v) = 'draft', 'versão 1 nasce em rascunho';
  assert test.errmsg(format($q$select public.pr_create_list_version(%L, %L, null, null)$q$, org, pl)) like '%revisão em andamento%', 'só uma revisão em andamento por lista';
  assert test.errmsg(format($q$select public.pr_submit_list_version(%L, %L)$q$, org, v)) like '%não tem itens%', 'lista vazia não é enviada';
  -- faixas de quantidade: sobreposição é impedida no banco
  assert test.errmsg(format($q$select public.pr_set_list_items(%L, %L, %L::jsonb)$q$, org, v, test.items(test.it(test.t('p1'), 3000, 0, 10), test.it(test.t('p1'), 2900, 5, 20)))) like '%conflicting key value violates exclusion constraint%', 'faixas de quantidade sobrepostas do mesmo item: recusadas';
  n := public.pr_set_list_items(org, v, test.items(test.it(test.t('p1'), 3000, 0, 9.999999), test.it(test.t('p1'), 3000, 10, null)));
  assert n = 2, 'faixas distintas do mesmo item são aceitas';
  -- item sem custo, preço com contribuição negativa e margem abaixo da mínima bloqueiam o envio
  n := public.pr_set_list_items(org, v, test.items(test.it(test.t('p1'), 3000), test.it(test.t('p2'), 5000)));
  assert test.errmsg(format($q$select public.pr_submit_list_version(%L, %L)$q$, org, v)) like '%1 item(ns) com preço inválido%', 'item sem versão de custo bloqueia o envio';
  assert (select x -> 'flags' from jsonb_array_elements(public.pr_validate_list_version(org, v)) x where x ->> 'sku' = 'P2') = '["missing_cost"]'::jsonb, 'a validação diz o motivo: custo ausente (não zero)';
  n := public.pr_set_list_items(org, v, test.items(test.it(test.t('p1'), 2500)));
  assert (select x -> 'flags' from jsonb_array_elements(public.pr_validate_list_version(org, v)) x) @> '["negative_contribution"]'::jsonb, '2500: contribuição negativa';
  assert test.errmsg(format($q$select public.pr_submit_list_version(%L, %L)$q$, org, v)) like '%preço inválido%', 'preço inválido bloqueia o envio';
  n := public.pr_set_list_items(org, v, test.items(test.it(test.t('p1'), 3000)));
  probs := public.pr_submit_list_version(org, v);
  assert (select status from public.price_list_versions where id = v) = 'pending' and jsonb_array_length(probs) = 1, 'preço válido: enviado para aprovação';
  assert test.errmsg(format($q$select public.pr_set_list_items(%L, %L, '[]'::jsonb)$q$, org, v)) like '%só rascunhos%', 'versão enviada não aceita edição de itens';
  assert test.errmsg(format($q$select public.pr_review_list_version(%L, %L, true, null)$q$, org, v)) like '%sem permissão%', 'analista não aprova lista';
  assert test.errmsg(format($q$update public.price_list_versions set status = 'published' where id = %L$q$, v)) like '%permission denied%', 'status da versão não é gravável direto';
  assert test.errmsg(format($q$insert into public.price_list_items (organization_id, price_list_version_id, pricing_item_id, price_cents) values (%L, %L, %L, 1)$q$, org, v, test.t('p1'))) like '%permission denied%', 'itens da lista só pelas funções';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); v uuid := test.t('lv1'); n integer;
begin
  assert test.errmsg(format($q$select public.pr_publish_list_version(%L, %L)$q$, org, v)) like '%só versões aprovadas%', 'não publica sem aprovar';
  perform public.pr_review_list_version(org, v, true, 'ok');
  n := public.pr_publish_list_version(org, v);
  assert n = 1 and (select status from public.price_list_versions where id = v) = 'published', 'publicada com 1 item';
  assert (select count(*) from public.price_change_events where list_version_id = v) = 1 and (select new_price_cents from public.price_change_events where list_version_id = v) = 3000, 'evento de histórico da publicação';
  assert test.errmsg(format($q$select public.pr_publish_list_version(%L, %L)$q$, org, v)) like '%já publicada%', 'segunda publicação recusada';
  assert test.errmsg(format($q$select public.pr_discard_list_version(%L, %L)$q$, org, v)) like '%só rascunhos%', 'versão publicada não é descartada';
  assert not exists (select 1 from public.item_channel_prices), 'publicar lista não altera o preço atual do item (são preços comerciais internos)';
end $$;
reset role;
do $$
declare v uuid := test.t('lv1');
begin
  assert test.errmsg(format($q$update public.price_list_items set price_cents = 1 where price_list_version_id = %L$q$, v)) like '%não aceita alteração de itens%', 'gatilho: itens da versão publicada imutáveis';
  assert test.errmsg(format($q$update public.price_list_versions set note = 'x' where id = %L$q$, v)) like '%é imutável%', 'gatilho: versão publicada não aceita edição';
  assert test.errmsg(format($q$update public.price_list_versions set status = 'draft' where id = %L$q$, v)) like '%transição inválida%', 'gatilho: publicada só pode virar aposentada';
  assert test.errmsg(format($q$delete from public.price_list_versions where id = %L$q$, v)) like '%só rascunhos%', 'gatilho: publicada não é apagada';
  raise notice 'PASS: listas de preço — rascunho, validação, aprovação, publicação única e imutabilidade';
end $$;

-- nova versão: copia a anterior, segregação e publicação que aposenta a anterior
:as_ma
do $$
declare org uuid := test.t('org'); pl uuid := test.t('pl'); v2 uuid; n integer;
begin
  v2 := public.pr_create_list_version(org, pl, current_date + 30, null, 'reajuste', test.t('lv1'));
  perform set_config('t.lv2', v2::text, true);
  assert (select count(*) from public.price_list_items where price_list_version_id = v2) = 1, 'a nova versão copia os itens da anterior';
  n := public.pr_set_list_items(org, v2, test.items(test.it(test.t('p1'), 3300)));
  perform public.pr_submit_list_version(org, v2);
  assert test.errmsg(format($q$select public.pr_review_list_version(%L, %L, true, null)$q$, org, v2)) like '%segregação%', 'segregação: quem enviou a lista não a aprova';
  perform public.pr_withdraw_list_version(org, v2);
  assert (select status from public.price_list_versions where id = v2) = 'draft', 'quem enviou retira da fila (volta a rascunho)';
  perform public.pr_submit_list_version(org, v2);
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org'); v1 uuid := test.t('lv1'); v2 uuid := test.t('lv2');
begin
  assert test.errmsg(format($q$select public.pr_review_list_version(%L, %L, false, 'x')$q$, org, v2)) like '%motivo da rejeição%', 'rejeição exige motivo';
  perform public.pr_review_list_version(org, v2, true, 'ok');
  -- o custo sobe antes da publicação: a revalidação bloqueia (3300 com custo 2700+ não atinge a mínima)
  update public.cost_components set amount_cents = 250000 where item_id = test.t('p1') and name = 'Compra';
  perform public.pr_save_cost_version(org, test.t('p1'), 'reajuste do fornecedor');
  assert test.errmsg(format($q$select public.pr_publish_list_version(%L, %L)$q$, org, v2)) like '%deixaram de atender às regras%', 'publicação revalida com o custo NOVO e bloqueia';
  update public.cost_components set amount_cents = 200000 where item_id = test.t('p1') and name = 'Compra';
  perform public.pr_save_cost_version(org, test.t('p1'), 'volta ao custo anterior');
  perform public.pr_publish_list_version(org, v2);
  assert (select status from public.price_list_versions where id = v2) = 'published' and (select status from public.price_list_versions where id = v1) = 'retired', 'publicar a nova versão aposenta a anterior que se sobrepõe (histórico preservado)';
  assert (select count(*) from public.price_change_events where list_version_id = v2 and previous_price_cents = 3000 and new_price_cents = 3300) = 1, 'evento da v2 guarda o preço anterior (3000) e o novo (3300)';
  assert (select count(*) from public.price_list_versions where price_list_id = test.t('pl')) = 2, 'as duas versões continuam consultáveis';
  perform public.pr_retire_list_version(org, v2);
  assert (select status from public.price_list_versions where id = v2) = 'retired', 'descontinuação controlada da versão publicada';
  raise notice 'PASS: listas — nova versão copia, segregação, revalidação na publicação e aposentadoria';
end $$;
reset role;

-- ===================================================================== cenários: snapshots recalculados no banco
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; sc uuid; v1 uuid;
begin
  r := public.pr_save_scenario(org, null, 'Atual', 'preços vigentes', jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000, 'suggested_price_cents', 4000)));
  sc := (r ->> 'scenario_id')::uuid; v1 := (r ->> 'version_id')::uuid;
  perform set_config('t.sc', sc::text, true); perform set_config('t.sv1', v1::text, true);
  assert (r ->> 'version_number')::int = 1, 'cenário nasce na versão 1';
  assert (select contribution_cents from public.pricing_scenario_items where scenario_version_id = v1) = 350 and (select fees_cents from public.pricing_scenario_items where scenario_version_id = v1) = 450, 'o banco recalculou: taxa 450, contribuição 350';
  assert (select margin_decimal from public.pricing_scenario_items where scenario_version_id = v1) = 11.6667 and (select direct_cost_cents from public.pricing_scenario_items where scenario_version_id = v1) = 2200, 'margem 11,6667 % e custo 2200 gravados pelo banco';
  assert (select suggestion_verified from public.pricing_scenario_items where scenario_version_id = v1) is true, 'sugestão 4000 verificada: atinge 30 % (contribuição 1200)';
  -- o navegador não manda totais: mesmo que tente, não há onde gravar valores calculados
  assert test.errmsg(format($q$insert into public.pricing_scenario_items (organization_id, scenario_version_id, pricing_item_id, channel_id, input_price_cents, direct_cost_cents, fees_cents, contribution_cents) values (%L, %L, %L, %L, 1, 1, 1, 999999)$q$, org, v1, test.t('p1'), test.t('ch'))) like '%permission denied%', 'não há escrita direta de resultados de cenário';
  -- sugestão que não atinge a meta é marcada como NÃO verificada
  r := public.pr_save_scenario(org, sc, 'ignorado', null, jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000, 'suggested_price_cents', 3900)));
  assert (r ->> 'version_number')::int = 2 and (select suggestion_verified from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) is false, 'sugestão 3900 (28,6 %) não é verificada';
  r := public.pr_save_scenario(org, sc, 'ignorado', null, jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000, 'suggested_price_cents', 99999)));
  assert (select suggestion_verified from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) is false, 'sugestão forjada e alta demais (99999) atinge a meta mas NÃO é o menor preço: não é verificada';
  -- cenário conservador: custo +10 % (2420) e promocional: desconto de 10 % (2700)
  r := public.pr_save_scenario(org, null, 'Conservador', null, jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000, 'cost_adjust_pct', 10)));
  assert (select contribution_cents from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) = 130 and (select direct_cost_cents from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) = 2420, 'custo +10 %: 2420; contribuição 3000 − 2420 − 450 = 130';
  r := public.pr_save_scenario(org, null, 'Promocional', null, jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000, 'discount_pct', 10)));
  assert (select input_price_cents from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) = 2700 and (select contribution_cents from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) = 95, 'desconto de 10 %: preço 2700, taxa recalculada 405, contribuição 95';
  assert (select viable from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) is false, 'cenário promocional abaixo da margem mínima: inviável';
  -- validações
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Atual', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L, 'price_cents', 3000)))$q$, org, test.t('p1'), test.t('ch'))) like '%já existe um cenário com este nome%', 'nome de cenário único';
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Sem custo', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L, 'price_cents', 3000)))$q$, org, test.t('p2'), test.t('ch'))) like '%sem versão de custo%', 'item sem custo não entra no cenário (nunca zero presumido)';
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Desconto absurdo', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L, 'price_cents', 3000, 'discount_pct', 100)))$q$, org, test.t('p1'), test.t('ch'))) like '%fora dos limites%', 'desconto de 100 % é recusado';
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Sem preço', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L)))$q$, org, test.t('p1'), test.t('ch'))) like '%informe o preço%', 'sem preço atual nem informado: recusado';
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Vazio', null, '[]'::jsonb)$q$, org)) like '%1 a 200 itens%', 'cenário vazio recusado';
end $$;
reset role;

-- o cenário salvo não muda quando a taxa global muda depois (snapshot)
:as_oa
do $$
declare org uuid := test.t('org'); sc uuid := test.t('sc'); r jsonb; before_ jsonb;
begin
  select output_snapshot_json into before_ from public.pricing_scenario_versions where id = test.t('sv1');
  update public.channel_fee_rules set rate_decimal = 20 where channel_id = test.t('ch');
  assert (select output_snapshot_json from public.pricing_scenario_versions where id = test.t('sv1')) = before_ and (select contribution_cents from public.pricing_scenario_items where scenario_version_id = test.t('sv1')) = 350, 'alterar a taxa depois NÃO muda a versão salva do cenário';
  r := public.pr_save_scenario(org, sc, 'x', null, jsonb_build_array(jsonb_build_object('item_id', test.t('p1'), 'channel_id', test.t('ch'), 'price_cents', 3000)));
  assert (select contribution_cents from public.pricing_scenario_items where scenario_version_id = (r ->> 'version_id')::uuid) = 3000 - 2200 - 600, 'a versão nova usa a taxa nova (20 %): contribuição 200';
  update public.channel_fee_rules set rate_decimal = 15 where channel_id = test.t('ch');
end $$;
reset role;
do $$
begin
  assert test.errmsg(format($q$update public.pricing_scenario_versions set output_snapshot_json = '{}' where id = %L$q$, test.t('sv1'))) like '%imutável%', 'versão de cenário imutável até para o dono do schema';
  assert test.errmsg(format($q$delete from public.pricing_scenario_items where scenario_version_id = %L$q$, test.t('sv1'))) like '%imutável%', 'itens do cenário imutáveis';
  raise notice 'PASS: cenários — recálculo no banco, snapshots imutáveis, sugestão verificada e limites';
end $$;

-- ===================================================================== arquivamento, permissões e isolamento
:as_na
do $$
declare org uuid := test.t('org');
begin
  perform public.pr_archive_scenario(org, test.t('sc'));
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, %L, 'x', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L, 'price_cents', 3000)))$q$, org, test.t('sc'), test.t('p1'), test.t('ch'))) like '%arquivado%', 'cenário arquivado não recebe versões';
end $$;
reset role;
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.pricing_scenarios) >= 3 and (select count(*) from public.price_list_versions) = 2, 'consulta lê cenários e listas';
  assert test.errmsg(format($q$select public.pr_save_scenario(%L, null, 'Consulta', null, jsonb_build_array(jsonb_build_object('item_id', %L, 'channel_id', %L, 'price_cents', 3000)))$q$, org, test.t('p1'), test.t('ch'))) like '%sem permissão%', 'consulta não salva cenário';
  assert test.errmsg(format($q$select public.pr_create_list_version(%L, %L, null, null)$q$, org, test.t('pl'))) like '%sem permissão%', 'consulta não cria versão de lista';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.pricing_scenarios) = 0 and (select count(*) from public.price_list_versions) = 0 and (select count(*) from public.pricing_scenario_items) = 0, 'empresa B não enxerga cenários nem listas da A';
  assert test.errmsg(format($q$select public.pr_publish_list_version(%L, %L)$q$, org, test.t('lv2'))) like '%sem permissão%', 'empresa B não publica lista da A';
  assert test.errmsg(format($q$select public.pr_analysis_inputs(%L)$q$, org)) like '%sem permissão%', 'empresa B não lê análise da A';
end $$;
reset role;

:as_na
do $$
declare org uuid := test.t('org'); a jsonb;
begin
  a := public.pr_analysis_inputs(org);
  assert jsonb_array_length(a) = 2 and (a -> 0 ->> 'sku') = 'P1' and (a -> 0 -> 'cost' ->> 'direct_unit_cents') is not null and (a -> 1 -> 'cost') = 'null'::jsonb, 'análise: P1 com custo vigente; P2 sem custo (null, nunca zero)';
  assert (a -> 0 #>> '{policy,scope}') = 'default' and (a -> 0 #>> '{policy,rules,target_margin_pct}')::numeric = 30, 'política padrão da empresa resolvida';
  assert jsonb_array_length(public.pr_analysis_inputs(org, null, test.t('ch'), 'service')) = 0 and jsonb_array_length(public.pr_analysis_inputs(org, null, null, 'product', test.t('p1'))) = 1, 'filtros por tipo e item aplicados no banco';
  assert test.errmsg(format($q$select public.pr_analysis_inputs(%L, null, null, 'banana')$q$, org)) like '%tipo de item inválido%', 'filtro inválido recusado';
  raise notice 'PASS: arquivamento, permissões, isolamento e entradas da análise';
end $$;
reset role;

rollback;
select 'PASS 82_pr_lists_scenarios' as result;

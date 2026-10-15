-- Custos (versões imutáveis, desconhecido ≠ zero), políticas (publicação, precedência, conflito), perfil tributário, solicitações de preço
-- (aprovação com segregação, publicação única, bloqueios de margem) e permissões por perfil. Valores calculados à mão em cada bloco.
--  Item P1: compra R$ 2.000,00 por 100 un. (20,00) + embalagem R$ 2,00 = custo direto unitário R$ 22,00 (2200).
--  Canal «Marketplace»: comissão 15 % sobre o preço. Política: meta 30 %, mínima 10 %.
--  Preço 3000: taxa 450, contribuição 350 (11,67 %) · preço 2500: taxa 375, contribuição −75 · preço 2600: taxa 390, contribuição 10 (0,38 %).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
-- Ponte de teste: funções private só executam como dono; estas leituras permitem conferir o resultado como cada perfil.
create function test.uc(p_item uuid) returns jsonb language sql security definer set search_path = '' as $$ select private.pr_unit_costs(p_item) $$;
create function test.rp(p_org uuid, p_item uuid, p_ch uuid, p_date date) returns jsonb language sql security definer set search_path = '' as $$ select private.pr_resolve_policy(p_org, p_item, p_ch, p_date) $$;
create function test.cf(p_org uuid, p_ch uuid, p_date date) returns jsonb language sql security definer set search_path = '' as $$ select private.pr_channel_fees(p_org, p_ch, p_date) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid; ch uuid; ch2 uuid;
begin
  org := public.create_organization('Precificação A', 'precificacao-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  assert exists (select 1 from public.pr_settings where organization_id = org), 'a empresa nasce com configurações padrão';
  assert (select default_target_margin_pct from public.pr_settings where organization_id = org) = 30 and (select segregation_of_duties from public.pr_settings where organization_id = org), 'padrões: meta 30 %, segregação ligada';
  insert into public.sales_channels (organization_id, name, channel_type) values (org, 'Marketplace', 'marketplace') returning id into ch;
  insert into public.sales_channels (organization_id, name, channel_type) values (org, 'Loja própria', 'own_site') returning id into ch2;
  perform set_config('t.ch', ch::text, true); perform set_config('t.ch2', ch2::text, true);
  insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal) values (org, ch, 'Comissão', 'commission', 'price', 15);
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('Empresa B', 'empresa-b-pr')::text, true); end $$;
reset role;

-- ===================================================================== cadastro e custos (analista cria; desconhecido ≠ zero)
:as_na
do $$
declare org uuid := test.t('org'); it uuid; v uuid;
begin
  insert into public.pricing_items (organization_id, item_type, sku, name, unit) values (org, 'product', 'P1', 'Produto 1', 'un') returning id into it;
  perform set_config('t.p1', it::text, true);
  assert test.errmsg(format($q$insert into public.pricing_items (organization_id, item_type, sku, name, current_base_price_cents) values (%L, 'product', 'P2', 'x', 100)$q$, org)) like '%permission denied%', 'o preço atual não é coluna gravável direto';
  assert test.errmsg(format($q$insert into public.pricing_items (organization_id, item_type, sku, name) values (%L, 'product', 'p1', 'duplicado')$q$, org)) like '%items_sku_uniq%', 'SKU único por empresa (ignora maiúsculas)';
  assert test.errmsg(format($q$update public.pricing_items set archived_at = now() where id = %L$q$, it)) like '%permission denied%' or test.errmsg(format($q$update public.pricing_items set status = 'inactive' where id = %L$q$, it)) like '%gestor%', 'analista não arquiva nem inativa';
  assert test.errmsg(format($q$select public.pr_save_cost_version(%L, %L, null)$q$, org, it)) like '%custo incompleto%nenhum componente%', 'sem componentes: não salva versão';
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity) values (org, it, 'direct', 'acquisition', 'Compra do lote', 200000, 100);
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents) values (org, it, 'direct', 'packaging', 'Embalagem', null);
  assert test.errmsg(format($q$select public.pr_save_cost_version(%L, %L, null)$q$, org, it)) like '%desconhecido não é zero%', 'componente sem valor: versão recusada (desconhecido ≠ zero)';
  assert (test.uc(it) ->> 'complete')::boolean is false and test.uc(it) -> 'direct_unit_cents' = 'null'::jsonb, 'custo direto indisponível, não zero';
  update public.cost_components set amount_cents = 200 where item_id = it and name = 'Embalagem';
  assert (test.uc(it) ->> 'direct_unit_cents') = '2200.000000', 'custo direto unitário = 20,00 + 2,00 = R$ 22,00 (2200)';
  v := public.pr_save_cost_version(org, it, 'primeira versão');
  assert (select direct_unit_cost_cents from public.cost_model_versions where id = v) = 2200 and (select version_number from public.cost_model_versions where id = v) = 1, 'versão 1 com custo direto 2200';
  assert (select jsonb_array_length(snapshot_json -> 'components') from public.cost_model_versions where id = v) = 2, 'o snapshot guarda os componentes';
  perform set_config('t.v1', v::text, true);
  -- editar o rascunho não altera a versão salva
  update public.cost_components set amount_cents = 300 where item_id = it and name = 'Embalagem';
  assert (select direct_unit_cost_cents from public.cost_model_versions where id = v) = 2200, 'editar o rascunho não muda a versão publicada';
  update public.cost_components set amount_cents = 200 where item_id = it and name = 'Embalagem';
  assert test.errmsg(format($q$update public.cost_model_versions set direct_unit_cost_cents = 1 where id = %L$q$, v)) like '%permission denied%', 'versão de custo não é editável pelo usuário';
  insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity, allocation_method) values (org, it, 'overhead', 'allocated_overhead', 'Aluguel', 300000, 1500, 'volume');
  assert test.uc(it) ->> 'overhead_unit_cents' = '200.000000' and test.uc(it) ->> 'full_unit_cents' = '2400.000000', 'rateio de R$ 3.000,00 ÷ 1.500 = R$ 2,00; custo completo 2400';
  raise notice 'PASS: custos — completude, desconhecido ≠ zero, versões e rateio';
end $$;
reset role;
do $$
declare v uuid := test.t('v1');
begin
  assert test.errmsg(format($q$update public.cost_model_versions set direct_unit_cost_cents = 1 where id = %L$q$, v)) like '%imutável%', 'gatilho: versão de custo imutável até para o dono do schema';
  assert test.errmsg(format($q$delete from public.cost_model_versions where id = %L$q$, v)) like '%imutável%', 'gatilho: versão de custo não é apagada';
  raise notice 'PASS: versões de custo imutáveis';
end $$;

-- ===================================================================== perfil tributário (informado), política, precedência e conflito
:as_ma
do $$
declare org uuid := test.t('org'); pol uuid; pol2 uuid; pol3 uuid; cat uuid; a1 uuid; n integer;
begin
  assert test.errmsg(format($q$insert into public.tax_profiles (organization_id, name) values (%L, 'Perfil')$q$, org)) like '%row-level security%', 'gestor não cadastra perfil tributário (só administrador)';
  insert into public.product_categories (organization_id, name) values (org, 'Cat teste 81') returning id into cat;
  insert into public.pricing_policies (organization_id, name, target_margin_decimal, minimum_margin_decimal, rounding_rule) values (org, 'Padrão 30', 30, 10, 'up') returning id into pol;
  perform set_config('t.pol', pol::text, true);
  assert test.errmsg(format($q$insert into public.pricing_policies (organization_id, name, target_margin_decimal, minimum_margin_decimal) values (%L, 'Inválida', 5, 10)$q$, org)) like '%check%', 'mínima acima da meta é recusada';
  assert (test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope') = 'default', 'política em rascunho não vale: usa o padrão da empresa';
  n := public.pr_publish_policy(org, pol);
  assert n = 1 and (select status from public.pricing_policies where id = pol) = 'published', 'publicar cria a versão 1';
  update public.pricing_policies set target_margin_decimal = 35 where id = pol;
  assert (select (rules_snapshot_json ->> 'target_margin_pct')::numeric from public.pricing_policy_versions where policy_id = pol and version_number = 1) = 30, 'editar o rascunho não altera a versão publicada';
  n := public.pr_publish_policy(org, pol);
  assert n = 2, 'nova publicação = versão 2';
  assert test.errmsg(format($q$update public.pricing_policy_versions set rules_snapshot_json = '{}' where policy_id = %L$q$, pol)) like '%permission denied%', 'versão de política não é editável';
  -- sem atribuição: padrão da empresa; com atribuição global: a política
  assert (test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope') = 'default', 'sem atribuições vale o padrão';
  insert into public.pricing_rule_assignments (organization_id, policy_id) values (org, pol) returning id into a1;
  assert test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope' = 'global' and (test.rp(org, test.t('p1'), test.t('ch'), current_date) #>> '{rules,target_margin_pct}')::numeric = 35, 'atribuição global usa a versão publicada mais recente (meta 35)';
  -- conflito: segunda atribuição global vigente é impedida pelo banco
  assert test.errmsg(format($q$insert into public.pricing_rule_assignments (organization_id, policy_id) values (%L, %L)$q$, org, pol)) like '%conflicting key value violates exclusion constraint%', 'conflito de precedência no mesmo escopo é impedido no banco';
  -- vigências disjuntas no mesmo escopo são permitidas
  insert into public.pricing_policies (organization_id, name, target_margin_decimal, minimum_margin_decimal) values (org, 'Canal 20', 20, 5) returning id into pol2;
  perform public.pr_publish_policy(org, pol2);
  insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id, valid_from, valid_until) values (org, pol2, test.t('ch'), date '2020-01-01', date '2020-12-31');
  insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id, valid_from) values (org, pol2, test.t('ch'), date '2021-01-01');
  assert test.errmsg(format($q$insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id, valid_from, valid_until) values (%L, %L, %L, date '2020-06-01', date '2021-03-01')$q$, org, pol2, test.t('ch'))) like '%exclusion%', 'vigências que se sobrepõem no mesmo escopo: recusadas';
  -- precedência: canal vence global; item+canal vence tudo
  assert test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope' = 'channel' and (test.rp(org, test.t('p1'), test.t('ch'), current_date) #>> '{rules,target_margin_pct}')::numeric = 20, 'canal (20 %) vence a regra global';
  assert (test.rp(org, test.t('p1'), test.t('ch'), date '2020-06-01') ->> 'scope') = 'channel', 'em 2020 vale a atribuição com vigência 2020';
  assert (test.rp(org, test.t('p1'), test.t('ch2'), current_date) ->> 'scope') = 'global', 'outro canal cai na regra global';
  insert into public.pricing_rule_assignments (organization_id, policy_id, item_id, channel_id) values (org, pol, test.t('p1'), test.t('ch'));
  assert (test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope') = 'item_channel', 'item + canal é o mais específico';
  assert test.errmsg(format($q$insert into public.pricing_rule_assignments (organization_id, policy_id, item_id, category_id) values (%L, %L, %L, %L)$q$, org, pol, test.t('p1'), cat)) like '%violates%check constraint%', 'item e categoria na mesma atribuição: recusado pela regra (categoria real)';
  assert test.errmsg(format($q$select public.pr_retire_policy(%L, %L)$q$, org, pol)) like '%atribuições vigentes%', 'política com atribuições vigentes não é aposentada';
  -- removemos o item+canal para que o canal (20 %) volte a valer nos próximos blocos
  delete from public.pricing_rule_assignments where item_id = test.t('p1');
  assert (test.rp(org, test.t('p1'), test.t('ch'), current_date) ->> 'scope') = 'channel', 'removida a atribuição específica, o canal volta a valer';
  -- política não publicada (rascunho ou aposentada) não vale, mesmo com atribuição na data
  insert into public.pricing_policies (organization_id, name, target_margin_decimal, minimum_margin_decimal) values (org, 'Antiga', 50, 5) returning id into pol3;
  perform public.pr_publish_policy(org, pol3);
  insert into public.pricing_rule_assignments (organization_id, policy_id, channel_id, valid_from, valid_until) values (org, pol3, test.t('ch2'), date '2019-01-01', date '2019-12-31');
  assert (test.rp(org, test.t('p1'), test.t('ch2'), date '2019-06-01') ->> 'scope') = 'channel', 'política publicada vale na vigência da atribuição';
  perform public.pr_retire_policy(org, pol3);
  assert (test.rp(org, test.t('p1'), test.t('ch2'), date '2019-06-01') ->> 'scope') = 'global', 'política aposentada não é aplicada';
  raise notice 'PASS: políticas — publicação, versões imutáveis, precedência, vigência e conflito';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org'); tp uuid;
begin
  assert test.errmsg(format($q$insert into public.tax_profiles (organization_id, name, configuration_json) values (%L, 'Sem origem', '{"taxes":[{"name":"X","rate_pct":5,"basis":"price"}]}')$q$, org)) like '%origem%', 'tributo sem origem do parâmetro é recusado';
  assert test.errmsg(format($q$insert into public.tax_profiles (organization_id, name, configuration_json) values (%L, 'Alta', '{"taxes":[{"name":"X","rate_pct":60,"basis":"price","source":"s"},{"name":"Y","rate_pct":40,"basis":"price","source":"s"}]}')$q$, org)) like '%100%', 'soma de tributos sobre preço ≥ 100 % é recusada';
  assert test.errmsg(format($q$insert into public.tax_profiles (organization_id, name, configuration_json) values (%L, 'Base', '{"taxes":[{"name":"X","rate_pct":5,"basis":"cost","source":"s"}]}')$q$, org)) like '%base%', 'base inválida é recusada';
  insert into public.tax_profiles (organization_id, name, configuration_json) values (org, 'Informado pelo contador', '{"taxes":[{"name":"Imposto X","rate_pct":6,"basis":"price","source":"Orientação do contador em 2026-10"}]}') returning id into tp;
  update public.sales_channels set tax_profile_id = tp where id = test.t('ch2');
  assert (select jsonb_array_length(test.cf(org, test.t('ch2'), current_date))) = 1 and test.cf(org, test.t('ch2'), current_date) #>> '{0,kind}' = 'tax', 'o tributo informado vira taxa do canal (kind tax)';
  update public.sales_channels set tax_profile_id = null where id = test.t('ch2');
  raise notice 'PASS: perfil tributário informado — origem obrigatória, soma < 100 pct, só administrador';
end $$;
reset role;

-- ===================================================================== solicitações de preço: segregação, publicação única, bloqueios
:as_na
do $$
declare org uuid := test.t('org'); it uuid := test.t('p1'); ch uuid := test.t('ch'); r1 uuid; r2 uuid; r3 uuid;
begin
  -- política vigente no canal: mínima 5 % (20 %/5 %), meta 20 %
  r1 := public.pr_request_price_change(org, it, ch, 3000, 'Preço de lançamento no marketplace');
  perform set_config('t.r1', r1::text, true);
  assert (select status from public.price_change_requests where id = r1) = 'pending' and (select previous_price_cents from public.price_change_requests where id = r1) is null, 'proposta nasce pendente, sem preço anterior';
  assert (select impact_json #>> '{check,evaluation,contribution_cents}' from public.price_change_requests where id = r1) = '350', 'impacto calculado pelo banco: contribuição 350';
  assert (select impact_json #>> '{check,evaluation,margin_pct}' from public.price_change_requests where id = r1) = '11.6667', 'margem 11,6667 %';
  assert test.errmsg(format($q$select public.pr_request_price_change(%L, %L, %L, 3100, 'Outra proposta em paralelo')$q$, org, it, ch)) like '%já existe uma proposta em andamento%', 'só uma proposta em andamento por item e canal';
  assert test.errmsg(format($q$select public.pr_request_price_change(%L, %L, %L, 3000, 'abc')$q$, org, it, ch)) like '%justificativa%', 'justificativa obrigatória';
  assert test.errmsg(format($q$select public.pr_review_price_change(%L, %L, true, null)$q$, org, r1)) like '%sem permissão%', 'analista não aprova';
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, r1)) like '%sem permissão%', 'analista não publica';
  assert test.errmsg(format($q$update public.price_change_requests set status = 'approved' where id = %L$q$, r1)) like '%permission denied%', 'o status não é gravável direto';
  assert test.errmsg(format($q$update public.pricing_items set current_base_price_cents = 1 where id = %L$q$, it)) like '%permission denied%', 'o preço do item não é gravável direto';
  assert test.errmsg(format($q$insert into public.item_channel_prices (organization_id, item_id, channel_id, price_cents) values (%L, %L, %L, 1)$q$, org, it, ch)) like '%permission denied%', 'preço por canal só pelas funções';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r1 uuid := test.t('r1'); r2 uuid;
begin
  -- o gestor não é quem propôs: aprova
  perform public.pr_review_price_change(org, r1, true, 'ok');
  assert (select status from public.price_change_requests where id = r1) = 'approved', 'gestor aprova a proposta do analista';
  assert test.errmsg(format($q$select public.pr_review_price_change(%L, %L, false, 'tarde demais')$q$, org, r1)) like '%já está aprovada%', 'segunda decisão sobre a mesma solicitação é recusada';
  perform public.pr_publish_price_change(org, r1);
  assert (select price_cents from public.item_channel_prices where item_id = test.t('p1') and channel_id = test.t('ch')) = 3000, 'publicar grava o preço no canal';
  assert (select count(*) from public.price_change_events where request_id = r1) = 1 and (select new_price_cents from public.price_change_events where request_id = r1) = 3000, 'evento de histórico registrado';
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, r1)) like '%já publicada%', 'segunda publicação da mesma solicitação é recusada (sem duplicar)';
  assert (select count(*) from public.price_change_events where request_id = r1) = 1, 'continua um único evento';
  assert test.errmsg(format($q$update public.price_change_events set new_price_cents = 1 where request_id = %L$q$, r1)) like '%permission denied%', 'histórico de preço não é editável';
  -- bloqueios: contribuição negativa e margem abaixo da mínima
  r2 := public.pr_request_price_change(org, test.t('p1'), test.t('ch'), 2500, 'Promoção agressiva para girar estoque');
  assert (select impact_json #> '{check,flags}' from public.price_change_requests where id = r2) @> '["negative_contribution", "below_minimum_margin"]'::jsonb, 'impacto sinaliza contribuição negativa e margem abaixo da mínima';
  perform set_config('t.r2', r2::text, true);
  -- segregação: o gestor não aprova a própria proposta
  assert test.errmsg(format($q$select public.pr_review_price_change(%L, %L, true, null)$q$, org, r2)) like '%segregação%', 'segregação: quem propôs não aprova a própria alteração';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org'); r2 uuid := test.t('r2'); r3 uuid;
begin
  assert test.errmsg(format($q$select public.pr_review_price_change(%L, %L, false, 'x')$q$, org, r2)) like '%motivo da rejeição%', 'rejeição exige motivo';
  perform public.pr_review_price_change(org, r2, true, 'aprovado por engano de teste');
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, r2)) like '%contribuição unitária ficaria negativa%', 'publicação bloqueada: contribuição negativa mesmo com aprovação';
  assert (select status from public.price_change_requests where id = r2) = 'approved' and (select price_cents from public.item_channel_prices where item_id = test.t('p1') and channel_id = test.t('ch')) = 3000, 'preço vigente não mudou';
  perform public.pr_cancel_price_change(org, r2);
  assert (select status from public.price_change_requests where id = r2) = 'cancelled', 'solicitação cancelada';
  -- margem abaixo da mínima (2600: contribuição 10, 0,38 %) bloqueia
  r3 := public.pr_request_price_change(org, test.t('p1'), test.t('ch'), 2600, 'Teste de margem mínima');
  update public.pr_settings set segregation_of_duties = false where organization_id = org;
  perform public.pr_review_price_change(org, r3, true, 'segregação desligada pelo administrador');
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, r3)) like '%margem abaixo da mínima%', 'publicação bloqueada: margem abaixo da mínima da política';
  perform public.pr_cancel_price_change(org, r3);
  update public.pr_settings set segregation_of_duties = true where organization_id = org;
  raise notice 'PASS: solicitações de preço — aprovação, segregação, publicação única e bloqueios de margem';
end $$;
reset role;

-- ===================================================================== custo muda depois da aprovação: preço desatualizado e bloqueio por custo novo
:as_na
do $$
declare org uuid := test.t('org'); r uuid;
begin
  r := public.pr_request_price_change(org, test.t('p1'), test.t('ch'), 3300, 'Reajuste anual');
  perform set_config('t.r4', r::text, true);
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r uuid := test.t('r4');
begin
  perform public.pr_review_price_change(org, r, true, 'ok');
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); it uuid := test.t('p1'); v2 uuid;
begin
  -- o custo sobe para R$ 30,00 antes da publicação: a versão nova de custo vale agora
  update public.cost_components set amount_cents = 600 where item_id = it and name = 'Embalagem';
  update public.cost_components set amount_cents = 220000 where item_id = it and name = 'Compra do lote';
  v2 := public.pr_save_cost_version(org, it, 'reajuste de fornecedor');
  assert (select direct_unit_cost_cents from public.cost_model_versions where id = v2) = 2800 and (select version_number from public.cost_model_versions where id = v2) = 2, 'versão 2: compra 22,00 + embalagem 6,00 = 2800';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); r uuid := test.t('r4');
begin
  -- 3300: taxa 495, contribuição 3300 − 2800 − 495 = 5 (0,15 %) → abaixo da mínima agora
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, r)) like '%margem abaixo da mínima%', 'publicação revalida com o custo NOVO e bloqueia';
  raise notice 'PASS: publicação revalida custos e taxas atuais';
end $$;
reset role;

-- ===================================================================== permissões por perfil, consulta e outra empresa
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.pricing_items) = 1 and (select count(*) from public.cost_model_versions) = 2, 'consulta lê itens e versões de custo';
  assert test.errmsg(format($q$insert into public.pricing_items (organization_id, item_type, sku, name) values (%L, 'product', 'V1', 'x')$q$, org)) like '%row-level security%', 'consulta não cadastra';
  assert test.errmsg(format($q$select public.pr_request_price_change(%L, %L, null, 5000, 'consulta tentando')$q$, org, test.t('p1'))) like '%sem permissão%', 'consulta não propõe preço';
  assert test.errmsg(format($q$select public.pr_save_cost_version(%L, %L, null)$q$, org, test.t('p1'))) like '%sem permissão%', 'consulta não salva versão de custo';
  assert test.errmsg(format($q$update public.channel_fee_rules set rate_decimal = 1 where organization_id = %L$q$, org)) is null and (select rate_decimal from public.channel_fee_rules limit 1) = 15, 'consulta não altera taxas (RLS filtra: 0 linhas)';
  assert test.errmsg(format($q$update public.pr_settings set segregation_of_duties = false where organization_id = %L$q$, org)) is null and (select segregation_of_duties from public.pr_settings), 'consulta não altera configurações';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$insert into public.sales_channels (organization_id, name) values (%L, 'Novo canal')$q$, org)) like '%row-level security%', 'analista não cria canal';
  assert test.errmsg(format($q$insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal) values (%L, %L, 'x', 'other', 'price', 1)$q$, org, test.t('ch'))) like '%row-level security%', 'analista não cadastra taxa';
  assert test.errmsg(format($q$select public.pr_publish_policy(%L, %L)$q$, org, test.t('pol'))) like '%sem permissão%', 'analista não publica política';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.pricing_items) = 0 and (select count(*) from public.cost_model_versions) = 0 and (select count(*) from public.price_change_requests) = 0, 'empresa B não enxerga nada da A';
  assert test.errmsg(format($q$select public.pr_request_price_change(%L, %L, null, 5000, 'invasão de outra empresa')$q$, org, test.t('p1'))) like '%sem permissão%', 'empresa B não propõe preço na A';
  assert test.errmsg(format($q$select public.pr_item_context(%L, %L, null, null)$q$, org, test.t('p1'))) like '%sem permissão%', 'empresa B não lê contexto da A';
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, test.t('orgb'), test.t('r1'))) like '%não encontrada%', 'ID de solicitação da A com org B: não encontrada';
end $$;
reset role;
:as_anon
do $$
begin
  assert test.errmsg('select count(*) from public.pricing_items') like '%permission denied%', 'anônimo não lê itens';
  assert test.errmsg(format($q$select public.pr_request_price_change(%L, %L, null, 5000, 'anônimo')$q$, test.t('org'), test.t('p1'))) like '%permission denied%', 'anônimo não executa funções do motor';
end $$;
reset role;

-- ===================================================================== preço desatualizado e MFA do administrador
:as_ma
do $$
declare org uuid := test.t('org'); it uuid := test.t('p1'); ra uuid; rb uuid;
begin
  perform public.pr_cancel_price_change(org, test.t('r4')); -- libera item × canal (a proposta de 3300 ficou bloqueada pelo custo novo)
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); it uuid := test.t('p1'); ra uuid; rb uuid;
begin
  ra := public.pr_request_price_change(org, it, null, 3200, 'Preço-base inicial do item');
  rb := public.pr_request_price_change(org, it, test.t('ch2'), 4000, 'Preço no canal depois do preço-base');
  perform set_config('t.ra', ra::text, true); perform set_config('t.rb', rb::text, true);
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org');
begin
  perform public.pr_review_price_change(org, test.t('ra'), true, 'ok');
  perform public.pr_review_price_change(org, test.t('rb'), true, 'ok');
  perform public.pr_publish_price_change(org, test.t('ra')); -- o preço-base muda para 3200 e vira o preço vigente (fallback) no canal sem preço próprio
  assert test.errmsg(format($q$select public.pr_publish_price_change(%L, %L)$q$, org, test.t('rb'))) like '%preço atual mudou desde a proposta%', 'publicação recusa solicitação cujo preço-base mudou depois da proposta';
  raise notice 'PASS: solicitação desatualizada não é publicada';
end $$;
reset role;
:as_oa
do $$
begin
  -- o proprietário só opera com a 2ª etapa (AAL2); com AAL1 o banco recusa
  perform set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal1","email":"oa@t.invalid"}', true);
  assert test.errmsg(format($q$select public.pr_save_cost_version(%L, %L, null)$q$, test.t('org'), test.t('p1'))) like '%duas etapas%', 'proprietário sem a 2ª etapa é barrado nas funções';
end $$;
reset role;

-- ===================================================================== avisos e auditoria
do $$
begin
  assert (select count(*) from public.pr_notifications where type = 'approval_pending' and organization_id = test.t('org')) >= 2, 'gestão recebeu avisos de aprovação pendente';
  assert (select count(*) from public.pr_notifications where type = 'cost_increase') >= 1, 'aumento relevante de custo avisou a gestão';
  assert exists (select 1 from public.audit_log where action = 'price_published'), 'publicação auditada';
  assert (select count(*) from public.audit_log where action in ('price_requested', 'price_approved', 'price_published', 'cost_version', 'policy_published')) >= 8, 'ações críticas registradas';
  assert (select count(*) from public.audit_log where changes::text ~* 'justif') = 0, 'a auditoria não guarda o texto livre das justificativas';
  raise notice 'PASS: avisos e auditoria';
end $$;

rollback;
select 'PASS 81_pr_costs_policies_requests' as result;

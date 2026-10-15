-- Avaliação direta no banco (espelho de lib/pricing/engine/evaluate.ts): MESMAS fixtures F1–F10 do motor TS (docs/PRICING_ENGINE.md §8).
-- Os valores abaixo foram conferidos à mão e são idênticos aos de tests/unit/pricing-engine.test.ts.

begin;

create function test.fee(id text, basis text, rate numeric default null, fixed numeric default null, mn numeric default null, mx numeric default null, kind text default 'commission') returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('id', id, 'name', id, 'kind', kind, 'basis', basis, 'rate_pct', rate, 'fixed_cents', fixed, 'min_cents', mn, 'max_cents', mx)) $$;
create function test.ev(p bigint, q numeric, c numeric, o numeric, fees jsonb) returns jsonb language sql as $$ select private.pr_evaluate(p, q, c, o, fees) $$;
create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;

do $$
declare r jsonb;
begin
  -- F1: R$ 50,00, taxa 15 %, margem ~25 %
  r := test.ev(8333, 1, 5000, null, jsonb_build_array(test.fee('t', 'price', 15)));
  assert (r ->> 'revenue_cents')::int = 8333 and (r #>> '{fees,0,amount_cents}')::int = 1250 and (r ->> 'contribution_cents')::int = 2083, 'F1: receita 8333, taxa 1250 (1249,95), contribuição 2083';
  assert r ->> 'margin_pct' = '24.9970' and r ->> 'markup_pct' = '66.6600', 'F1: margem 24,9970 % e markup 66,66 %';
  r := test.ev(8334, 1, 5000, null, jsonb_build_array(test.fee('t', 'price', 15)));
  assert (r ->> 'contribution_cents')::int = 2084 and r ->> 'margin_pct' = '25.0060', 'F1: 8334 → contribuição 2084, margem 25,0060 %';
  raise notice 'PASS: F1 · exemplo do prompt (R$ 50,00, taxa 15 pct, margem 25 pct)';

  -- F2: equilíbrio
  r := test.ev(6000, 1, 5000, null, jsonb_build_array(test.fee('t', 'price', 15), test.fee('f', 'fixed_unit', null, 100, null, null, 'transaction')));
  assert (r #>> '{fees,0,amount_cents}')::int = 900 and (r #>> '{fees,1,amount_cents}')::int = 100 and (r ->> 'contribution_cents')::int = 0, 'F2: equilíbrio em 6000, contribuição zero';
  raise notice 'PASS: F2 · equilíbrio unitário';

  -- F4: taxa sobre preço líquido
  r := test.ev(7962, 1, 5000, null, jsonb_build_array(test.fee('plat', 'price', 10), test.fee('imp', 'net_price', 8, null, null, null, 'tax')));
  assert (select (e ->> 'amount_cents')::int from jsonb_array_elements(r -> 'fees') e where e ->> 'id' = 'plat') = 796
     and (select (e ->> 'amount_cents')::int from jsonb_array_elements(r -> 'fees') e where e ->> 'id' = 'imp') = 573, 'F4: 10 % de 7962 = 796; 8 % de (7962 − 796) = 573';
  assert (r ->> 'contribution_cents')::int = 7962 - 5000 - 796 - 573, 'F4: contribuição 1593';
  raise notice 'PASS: F4 · taxa sobre preço líquido';

  -- F5: teto
  r := test.ev(6875, 1, 5000, null, jsonb_build_array(test.fee('com', 'price', 10, null, null, 500)));
  assert (r #>> '{fees,0,amount_cents}')::int = 500 and r #>> '{fees,0,capped}' = 'max' and (r ->> 'contribution_cents')::int = 1375, 'F5: comissão limitada ao teto (500), contribuição 1375';
  r := test.ev(1445, 1, 1000, null, jsonb_build_array(test.fee('pag', 'price', 2, null, 300)));
  assert r #>> '{fees,0,capped}' = 'min' and (r #>> '{fees,0,amount_cents}')::int = 300, 'F5: piso aplicado';
  raise notice 'PASS: F5 · taxa com teto e piso';

  -- F6: markup não é margem; F8: custo-base zero
  r := test.ev(8000, 1, 5000, null, '[]'::jsonb);
  assert r ->> 'margin_pct' = '37.5000' and r ->> 'markup_pct' = '60.0000', 'F6: margem 37,5 % e markup 60 %';
  assert (private.pr_evaluate(8000, 1, 5000, 1000, '[]'::jsonb, true) ->> 'markup_pct') = '33.3333', 'F6: markup sobre custo completo = 33,3333 %';
  r := test.ev(1000, 1, 0, null, '[]'::jsonb);
  assert r -> 'markup_pct' = 'null'::jsonb and r ->> 'margin_pct' = '100.0000', 'F8: custo-base zero → markup não calculável (null), margem calculável';
  raise notice 'PASS: F6/F8 · markup, margem e custo-base zero';

  -- F9: quantidade e taxa fixa por transação
  r := test.ev(2500, 10, 1000, null, jsonb_build_array(test.fee('f', 'fixed_transaction', null, 500, null, null, 'transaction')));
  assert (r ->> 'revenue_cents')::int = 25000 and (r ->> 'variable_cost_cents')::int = 10000 and (r ->> 'total_fees_cents')::int = 500 and (r ->> 'contribution_cents')::int = 14500, 'F9: 25000 − 10000 − 500 = 14500';
  raise notice 'PASS: F9 · quantidade e taxa por transação';

  -- F10: rateio e resultado gerencial
  r := test.ev(8334, 1, 5000, 200, jsonb_build_array(test.fee('t', 'price', 15)));
  assert (r ->> 'overhead_cents')::int = 200 and (r ->> 'managerial_cents')::int = 1884, 'F10: gerencial = 2084 − 200';
  raise notice 'PASS: F10 · rateio e resultado gerencial';

  -- taxa sobre custo e unidade fracionária de custo
  r := test.ev(10000, 1, 1234.5678, null, jsonb_build_array(test.fee('c', 'cost', 10)));
  assert (r ->> 'variable_cost_cents')::int = 1235 and (r #>> '{fees,0,amount_cents}')::int = 124, 'custo fracionário arredonda uma vez (1235) e a taxa sobre custo usa o valor em centavos (123,5 → 124)';
  raise notice 'PASS: taxa sobre custo e fração de centavo';

  -- validações
  assert test.errmsg('select private.pr_evaluate(0, 1, 1, null, ''[]''::jsonb)') like '%preço inválido%', 'preço zero recusado';
  assert test.errmsg('select private.pr_evaluate(100, 0, 1, null, ''[]''::jsonb)') like '%quantidade inválida%', 'quantidade zero recusada';
  assert test.errmsg('select private.pr_evaluate(100, 1, -1, null, ''[]''::jsonb)') like '%custo variável inválido%', 'custo negativo recusado';
  assert test.errmsg($q$select private.pr_evaluate(100, 1, 1, null, '[{"id":"x","basis":"banana"}]'::jsonb)$q$) like '%taxa inválida%', 'base desconhecida recusada';
  raise notice 'PASS: validações da avaliação direta';
end $$;

rollback;
select 'PASS 80_pr_evaluate' as result;

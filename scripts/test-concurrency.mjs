#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova: a mesma solicitação de preço é publicada uma única vez; aprovar × rejeitar tem um vencedor só; propostas paralelas para o mesmo item e canal
// viram uma única; versões de custo, de política e de cenário saem numeradas sem buracos nem duplicidade; publicação simultânea da mesma lista vale uma vez;
// atribuições conflitantes de política não coexistem; a mesma importação não é aplicada duas vezes.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-pr-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a0';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: depois de armGun(), toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina;
// assim as sessões entram no motor AO MESMO TEMPO, não uma depois da outra.
const GUN_KEY = 7777002;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, { asOwner = false } = {}) {
  const wrapped = asOwner
    ? `begin; select set_config('request.jwt.claims', '{"sub":"${OWNER}","aal":"aal2","email":"oa@t.invalid"}', true); set local role authenticated; ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`
    : sql;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(wrapped);
  });
}
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await psql("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, opts) => { const r = await psql(sql, opts); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const fire = async (n, make) => { await armGun(); return Promise.all(Array.from({ length: n }, (_, k) => make(k))); };
const lastLine = (r) => r.out.split('\n').filter(Boolean).pop();
const oks = (rs) => rs.filter((r) => r.code === 0).length;

let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).sort().map((x) => `migrations/${x}`)]) {
    const r = await psql(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  await psql(`insert into auth.users (id, email) values ('${OWNER}', 'oa@t.invalid')`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-pr')`, { asOwner: true });
  await psql(`update public.pr_settings set segregation_of_duties = false where organization_id = '${org}'`);
  const ch = await one(`insert into public.sales_channels (organization_id, name, channel_type) values ('${org}', 'Marketplace', 'marketplace') returning id`, { asOwner: true });
  await one(`insert into public.channel_fee_rules (organization_id, channel_id, name, fee_type, basis, rate_decimal) values ('${org}', '${ch}', 'Comissão', 'commission', 'price', 15) returning id`, { asOwner: true });
  const item = async (sku) => {
    const id = await one(`insert into public.pricing_items (organization_id, item_type, sku, name) values ('${org}', 'product', '${sku}', 'Item ${sku}') returning id`, { asOwner: true });
    await one(`insert into public.cost_components (organization_id, item_id, cost_class, cost_type, name, amount_cents, quantity) values ('${org}', '${id}', 'direct', 'acquisition', 'Compra', 220000, 100) returning id`, { asOwner: true });
    await one(`select public.pr_save_cost_version('${org}', '${id}', 'inicial')`, { asOwner: true });
    return id;
  };
  const request = (it, price, key) => psql(`select public.pr_request_price_change('${org}', '${it}', '${ch}', ${price}, 'Proposta concorrente ${key}')`, { asOwner: true });

  // 1) publicar a MESMA solicitação aprovada em 8 sessões: um único evento
  const a1 = await item('C1');
  const req1 = lastLine(await request(a1, 3500, 'a'));
  await one(`select public.pr_review_price_change('${org}', '${req1}', true, 'ok')`, { asOwner: true });
  const r1 = await fire(8, () => psql(`select public.pr_publish_price_change('${org}', '${req1}')`, { asOwner: true }));
  check(oks(r1) === 1, `8 publicações simultâneas da mesma solicitação: só 1 vale (valeram ${oks(r1)})`);
  check(r1.filter((r) => r.code !== 0).every((r) => /já publicada/.test(r.err)), 'as demais falham por «solicitação já publicada»');
  check(Number(await one(`select count(*) from public.price_change_events where request_id = '${req1}'`)) === 1 && Number(await one(`select price_cents from public.item_channel_prices where item_id = '${a1}'`)) === 3500, 'um único evento de preço e o preço publicado é 3500');

  // 2) aprovar × rejeitar em paralelo: um vencedor, estado coerente
  const a2 = await item('C2');
  const req2 = lastLine(await request(a2, 3600, 'b'));
  const r2 = await fire(6, (k) => psql(`select public.pr_review_price_change('${org}', '${req2}', ${k % 2 === 0}, 'decisão concorrente de teste')`, { asOwner: true }));
  check(oks(r2) === 1, `6 decisões simultâneas (3 aprovam, 3 rejeitam): só 1 vale (valeram ${oks(r2)})`);
  check(r2.filter((r) => r.code !== 0).every((r) => /já está/.test(r.err)), 'as demais falham por «solicitação já está …»');
  const st2 = await one(`select status from public.price_change_requests where id = '${req2}'`);
  check(['approved', 'rejected'].includes(st2) && Number(await one(`select count(*) from public.audit_log where entity_id = '${req2}' and action in ('price_approved', 'price_rejected')`)) === 1, `uma única decisão auditada (estado final: ${st2})`);

  // 3) 10 propostas paralelas para o mesmo item e canal: só uma fica em andamento
  const a3 = await item('C3');
  const r3 = await fire(10, (k) => request(a3, 3700 + k, `p${k}`));
  check(oks(r3) === 1 && r3.filter((r) => r.code !== 0).every((r) => /já existe uma proposta em andamento/.test(r.err)), `10 propostas simultâneas no mesmo item e canal: 1 entra, as outras recebem «já existe uma proposta em andamento» (entraram ${oks(r3)})`);

  // 4) versões de custo simultâneas: numeração contínua e sem repetição
  const a4 = await item('C4');
  const r4 = await fire(8, (k) => psql(`select public.pr_save_cost_version('${org}', '${a4}', 'versão paralela ${k}')`, { asOwner: true }));
  const nums4 = (await one(`select string_agg(version_number::text, ',' order by version_number) from public.cost_model_versions where item_id = '${a4}'`)).split(',').map(Number);
  check(oks(r4) === 8 && nums4.length === 9 && nums4.every((n, i) => n === i + 1), `8 versões de custo simultâneas: todas gravam e a numeração é 1..9 sem buracos (obtido ${nums4.join(',')})`);

  // 5) política: 6 publicações simultâneas → versões 1..6; 6) atribuições globais simultâneas → só uma
  const pol = await one(`insert into public.pricing_policies (organization_id, name, target_margin_decimal, minimum_margin_decimal) values ('${org}', 'Política concorrente', 30, 10) returning id`, { asOwner: true });
  const r5 = await fire(6, () => psql(`select public.pr_publish_policy('${org}', '${pol}')`, { asOwner: true }));
  const nums5 = (await one(`select string_agg(version_number::text, ',' order by version_number) from public.pricing_policy_versions where policy_id = '${pol}'`)).split(',').map(Number);
  check(oks(r5) === 6 && nums5.every((n, i) => n === i + 1), `6 publicações simultâneas da política: versões 1..6 sem buracos (obtido ${nums5.join(',')})`);
  const r6 = await fire(6, () => psql(`insert into public.pricing_rule_assignments (organization_id, policy_id) values ('${org}', '${pol}')`, { asOwner: true }));
  check(oks(r6) === 1 && r6.filter((r) => r.code !== 0).every((r) => /exclusion constraint/.test(r.err)), `6 atribuições globais simultâneas: só 1 existe (as outras violam a restrição de exclusão; entrou ${oks(r6)})`);

  // 7) cenário: 6 salvamentos simultâneos na mesma linha de cenário → versões 2..7
  const a7 = await item('C7');
  const first = JSON.parse(await one(`select public.pr_save_scenario('${org}', null, 'Cenário concorrente', null, '[{"item_id":"${a7}","channel_id":"${ch}","price_cents":3000}]'::jsonb)`, { asOwner: true }));
  const r7 = await fire(6, (k) => psql(`select public.pr_save_scenario('${org}', '${first.scenario_id}', 'x', null, '[{"item_id":"${a7}","channel_id":"${ch}","price_cents":${3000 + k}}]'::jsonb)`, { asOwner: true }));
  const nums7 = (await one(`select string_agg(version_number::text, ',' order by version_number) from public.pricing_scenario_versions where scenario_id = '${first.scenario_id}'`)).split(',').map(Number);
  check(oks(r7) === 6 && nums7.every((n, i) => n === i + 1) && nums7.length === 7, `6 versões de cenário simultâneas: numeração 1..7 sem buracos (obtido ${nums7.join(',')})`);

  // 8) lista de preços: 6 criações simultâneas de revisão → uma só; publicação simultânea da mesma versão aprovada → uma só
  const a8 = await item('C8');
  const pl = await one(`insert into public.price_lists (organization_id, name, channel_id) values ('${org}', 'Tabela concorrente', '${ch}') returning id`, { asOwner: true });
  const r8 = await fire(6, () => psql(`select public.pr_create_list_version('${org}', '${pl}', current_date, null)`, { asOwner: true }));
  check(oks(r8) === 1 && r8.filter((r) => r.code !== 0).every((r) => /revisão em andamento/.test(r.err)), `6 criações simultâneas de revisão da mesma lista: só 1 (criou ${oks(r8)})`);
  const lv = await one(`select id from public.price_list_versions where price_list_id = '${pl}'`);
  await one(`select public.pr_set_list_items('${org}', '${lv}', '[{"item_id":"${a8}","price_cents":3500}]'::jsonb)`, { asOwner: true });
  await one(`select jsonb_array_length(public.pr_submit_list_version('${org}', '${lv}'))`, { asOwner: true });
  await psql(`update public.pr_settings set segregation_of_duties = false where organization_id = '${org}'`);
  await one(`select public.pr_review_list_version('${org}', '${lv}', true, 'ok')`, { asOwner: true });
  const r9 = await fire(6, () => psql(`select public.pr_publish_list_version('${org}', '${lv}')`, { asOwner: true }));
  check(oks(r9) === 1 && Number(await one(`select count(*) from public.price_change_events where list_version_id = '${lv}'`)) === 1, `6 publicações simultâneas da mesma versão de lista: só 1 vale e há 1 evento (valeram ${oks(r9)})`);
  check(r9.filter((r) => r.code !== 0).every((r) => /já publicada/.test(r.err)), 'as 5 recusadas dizem «versão já publicada» (a trava da versão serializa; não é só o gatilho que barra)');

  // 9) importação: confirmar o mesmo job 6 vezes → aplica uma vez
  const rows = Array.from({ length: 5 }, (_, k) => ({ name: `Categoria ${k}` }));
  const imp = JSON.parse(await one(`select public.pr_create_import('${org}', 'categories', 'c.csv', '${'a'.repeat(64)}', '${JSON.stringify(rows)}'::jsonb)`, { asOwner: true }));
  const r10 = await fire(6, () => psql(`select public.pr_commit_import('${org}', '${imp.import_id}')`, { asOwner: true }));
  check(r10.every((r) => r.code === 0) && Number(await one(`select count(*) from public.product_categories where organization_id = '${org}'`)) === 5, '6 confirmações simultâneas do mesmo job: 5 categorias, sem duplicar');

  // consistência final: cada solicitação publicada tem exatamente um evento; nenhum item com mais de um evento por solicitação
  check(Number(await one(`select count(*) from public.price_change_requests r where r.status = 'published' and (select count(*) from public.price_change_events e where e.request_id = r.id) <> 1`)) === 0, 'toda solicitação publicada tem exatamente um evento');
  check(Number(await one(`select count(*) from (select request_id from public.price_change_events where request_id is not null group by request_id having count(*) > 1) x`)) === 0, 'nenhuma solicitação gerou eventos duplicados');
  check(Number(await one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and datname = 'core'`)) === 0, 'nenhuma sessão ficou presa em trava (sem impasse)');
} catch (e) {
  console.error(String(e.message ?? e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);

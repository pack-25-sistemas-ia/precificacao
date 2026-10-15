#!/usr/bin/env node
// Teste de mutação das regras críticas (banco E motor TypeScript): quebra cada regra DE PROPÓSITO numa cópia do código
// e exige que a suíte reprove. Se alguma mutação sobreviver, falta teste.
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais; rode SEM outra carga na máquina)
//   suite 'unit' → vitest nos testes do motor (lib/pricing)
// Cada mutação aponta para a definição VIVA (as migrações não redefinem funções umas das outras).
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

// { name, file (trecho do arquivo de migração) | ts (caminho do arquivo TS), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // --- avaliação direta (espelho SQL do motor)
  { name: 'avaliação: taxa arredondada para baixo', file: 'pr_guards', nth: 1, find: '    amt := round(amt);', replace: '    amt := trunc(amt);' },
  { name: 'avaliação: preço líquido ignora as taxas sobre o preço', file: 'pr_guards', find: 'net := greatest(0, rev - price_fees);', replace: 'net := rev;' },
  { name: 'avaliação: teto de taxa ignorado', file: 'pr_guards', nth: 1, find: "if mx is not null and amt > mx then amt := mx; capped := 'max'; end if;", replace: '' },
  { name: 'avaliação: piso de taxa ignorado', file: 'pr_guards', nth: 1, find: "if mn is not null and amt < mn then amt := mn; capped := 'min'; end if;", replace: '' },
  { name: 'avaliação: markup sobre custo completo ignorado', file: 'pr_guards', find: 'base := case when p_markup_full then p_cost + coalesce(p_overhead, 0) else p_cost end;', replace: 'base := p_cost;' },
  { name: 'avaliação: quantidade zero aceita', file: 'pr_guards', find: "if p_qty is null or p_qty <= 0 then raise exception 'quantidade inválida' using errcode = '22023'; end if;", replace: '' },
  // --- custo: desconhecido não é zero
  { name: 'custo: componente sem valor vira zero', file: 'pr_guards', find: "      direct_known := false;\n      issues := issues || jsonb_build_object('code', 'unknown_cost', 'component_id', c.id);\n    else", replace: "      issues := issues;\n    else" },
  { name: 'custo: item sem componentes é completo', file: 'pr_guards', find: "if direct_n = 0 then direct_known := false;", replace: 'if false then direct_known := false;' },
  { name: 'custo: versão salva com custo incompleto', file: 'pr_engine', find: "if not (uc ->> 'complete')::boolean then", replace: 'if false then' },
  { name: 'custo: versão de custo editável', file: 'pr_guards', find: "foreach t in array array['cost_model_versions', 'pricing_policy_versions', 'pricing_scenario_versions', 'pricing_scenario_items', 'price_change_events'] loop", replace: "foreach t in array array['pricing_policy_versions', 'pricing_scenario_versions', 'pricing_scenario_items', 'price_change_events'] loop" },
  { name: 'custo: rateio por volume sem divisor', file: 'pr_guards', find: 'else u := c.amount_cents / c.quantity; end if;', replace: 'else u := c.amount_cents; end if;' },
  // --- políticas e precedência
  { name: 'precedência: ordem invertida (global vence)', file: 'pr_engine', find: "array['item_channel', 'item', 'category_channel', 'category', 'channel', 'global']", replace: "array['global', 'channel', 'category', 'category_channel', 'item', 'item_channel']" },
  { name: 'política: rascunho passa a valer', file: 'pr_engine', find: "p.status = 'published'", replace: "p.status is not null" },
  { name: 'precedência: conflito no mesmo escopo permitido', file: 'pr_schema', find: "exclude using gist (organization_id with =, scope_key with =, daterange(valid_from, valid_until, '[]') with &&)", replace: 'check (true)' },
  { name: 'precedência: item e categoria na mesma atribuição', file: 'pr_schema', find: 'check (not (item_id is not null and category_id is not null)),', replace: 'check (true),' },
  { name: 'tributo: soma ≥ 100 % aceita', file: 'pr_guards', find: "if price_sum >= 100 then raise exception 'perfil tributário: a soma das alíquotas sobre o preço chega a 100 %% ou mais' using errcode = '23514'; end if;", replace: '' },
  { name: 'tributo: origem do parâmetro opcional', file: 'pr_guards', find: "if coalesce(trim(t ->> 'source'), '') = '' then raise exception 'perfil tributário: informe a origem do parâmetro (ex.: orientação do contador)' using errcode = '23514'; end if;", replace: '' },
  // --- aprovação e publicação
  { name: 'aprovação: quem propôs aprova a própria alteração', file: 'pr_engine', find: "if coalesce(seg, true) and r.requested_by = (select auth.uid()) then raise exception 'segregação de funções: quem propôs não pode aprovar ou rejeitar a própria alteração' using errcode = '42501'; end if;", replace: '' },
  { name: 'aprovação: rejeição sem motivo', file: 'pr_engine', find: "if not p_approve and (p_note is null or char_length(trim(p_note)) < 5) then raise exception 'informe o motivo da rejeição (mínimo de 5 caracteres)' using errcode = '22023'; end if;", replace: '' },
  { name: 'publicação: segunda publicação aceita', file: 'pr_engine', find: "if r.status = 'published' then raise exception 'solicitação já publicada' using errcode = '23514'; end if;", replace: '' },
  { name: 'publicação: preço desatualizado não é detectado', file: 'pr_engine', find: "if cur is distinct from r.previous_price_cents then raise exception 'o preço atual mudou desde a proposta: cancele e proponha novamente' using errcode = '40001'; end if;", replace: '' },
  { name: 'publicação: contribuição negativa aceita', file: 'pr_engine', find: "if chk -> 'flags' ? 'negative_contribution' then raise exception 'publicação bloqueada: a contribuição unitária ficaria negativa com os custos e taxas atuais' using errcode = '23514'; end if;", replace: '' },
  { name: 'publicação: margem abaixo da mínima aceita', file: 'pr_engine', find: "if chk -> 'flags' ? 'below_minimum_margin' then raise exception 'publicação bloqueada: margem abaixo da mínima da política' using errcode = '23514'; end if;", replace: '' },
  { name: 'permissão: analista aprova e publica', file: 'pr_guards', find: "when 'manager' then private.pr_is_manager(p_org)", replace: "when 'manager' then private.pr_is_analyst(p_org)" },
  { name: 'permissão: analista arquiva item', file: 'pr_guards', find: 'and not private.pr_is_manager(new.organization_id) then', replace: 'and false then' },
  { name: 'MFA: verificação em duas etapas ignorada nas funções', file: 'pr_guards', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;", replace: '' },
  { name: 'isolamento: leitura aberta a todos', file: 'pr_schema', find: "select coalesce(private.pr_role(org) in ('owner', 'admin', 'manager', 'member'), false); $$;", replace: 'select true; $$;' },
  // --- listas de preço
  { name: 'lista: versão publicada editável', file: 'pr_guards', find: "elsif old.status = new.status then raise exception 'versão de lista % é imutável', old.status using errcode = '23514';", replace: 'elsif old.status = new.status then null;' },
  { name: 'lista: envio com preço inválido aceito', file: 'pr_lists', find: "if bad > 0 then raise exception '% item(ns) com preço inválido: custo ausente, contribuição negativa ou margem abaixo da mínima — corrija antes de enviar', bad using errcode = '23514'; end if;", replace: '' },
  { name: 'lista: publicação não revalida custos e taxas', file: 'pr_lists', find: "if bad > 0 then raise exception 'publicação bloqueada: % item(ns) deixaram de atender às regras com os custos, taxas ou políticas atuais', bad using errcode = '23514'; end if;", replace: '' },
  { name: 'lista: versão anterior não é aposentada', file: 'pr_lists', find: "    update public.price_list_versions set status = 'retired' where id = old.id;", replace: '    null;' },
  { name: 'lista: segregação ignorada', file: 'pr_lists', find: "if coalesce(seg, true) and v.submitted_by = (select auth.uid()) then raise exception 'segregação de funções: quem enviou não pode aprovar ou rejeitar a própria lista' using errcode = '42501'; end if;", replace: '' },
  { name: 'lista: faixas de quantidade sobrepostas', file: 'pr_schema', find: "exclude using gist (price_list_version_id with =, pricing_item_id with =, numrange(coalesce(minimum_quantity_decimal, 0), maximum_quantity_decimal, '[]') with &&)", replace: 'check (true)' },
  // --- cenários
  { name: 'cenário: sugestão forjada alta demais é verificada', file: 'pr_scenarios', find: "then verified := false; end if;", replace: 'then null; end if;' },
  { name: 'cenário: item sem custo entra no cenário', file: 'pr_scenarios', find: "if cost_ is null or jsonb_typeof(cost_) = 'null' then raise exception 'item «%» sem versão de custo: não pode entrar no cenário', it.sku using errcode = '23514'; end if;", replace: '' },
  { name: 'cenário: desconto de 100 % aceito', file: 'pr_scenarios', find: 'or disc < 0 or disc >= 100 then', replace: 'or disc < 0 or disc > 100 then' },
  { name: 'cenário: versão editável', file: 'pr_guards', find: "'pricing_scenario_versions', 'pricing_scenario_items', 'price_change_events'] loop", replace: "'pricing_scenario_items', 'price_change_events'] loop" },
  // --- importação e vendas
  { name: 'importação: mesmo arquivo reimportado', file: 'pr_import', find: "if exist is not null then return jsonb_build_object('duplicate_file', true, 'import_id', exist); end if;", replace: '' },
  { name: 'importação: confirmar duas vezes aplica de novo', file: 'pr_import', find: "if j.status = 'completed' then return jsonb_build_object('already', true, 'applied', j.successful_rows); end if;", replace: '' },
  { name: 'importação: analista importa taxas e vendas', file: 'pr_import', find: "select case when p_type in ('items', 'costs', 'prices') then 'analyst' else 'manager' end $$;", replace: "select 'analyst' $$;" },
  { name: 'importação: preço sem versão de custo aceito', file: 'pr_import', find: "if not exists (select 1 from public.cost_model_versions v where v.item_id = it) then return 'item sem versão de custo: salve o custo antes de propor preço'; end if;", replace: '' },
  { name: 'vendas: margem ponderada inclui vendas sem custo', file: 'pr_import', find: '/ (sum(net) filter (where contrib is not null)) * 100, 4)', replace: '/ sum(net) * 100, 4)' },
  { name: 'exportação: analista registra e exporta', file: 'pr_import', find: "perform private.pr_guard(p_org, 'manager');\n  if p_report is null", replace: "perform private.pr_guard(p_org, 'analyst');\n  if p_report is null" },
  // --- concorrência (suíte própria)
  { name: 'concorrência: publicação sem trava', file: 'pr_engine', suite: 'conc', nth: 3, find: 'select * into r from public.price_change_requests where id = p_request and organization_id = p_org for update;', replace: 'select * into r from public.price_change_requests where id = p_request and organization_id = p_org;' },
  { name: 'concorrência: decisão sem trava', file: 'pr_engine', suite: 'conc', nth: 1, find: 'select * into r from public.price_change_requests where id = p_request and organization_id = p_org for update;', replace: 'select * into r from public.price_change_requests where id = p_request and organization_id = p_org;' },
  { name: 'concorrência: versão de custo sem trava do item', file: 'pr_engine', suite: 'conc', find: 'select * into it from public.pricing_items where id = p_item and organization_id = p_org for update;', replace: 'select * into it from public.pricing_items where id = p_item and organization_id = p_org;' },
  { name: 'concorrência: publicação de política sem trava', file: 'pr_engine', suite: 'conc', find: 'select * into p from public.pricing_policies where id = p_policy and organization_id = p_org for update;', replace: 'select * into p from public.pricing_policies where id = p_policy and organization_id = p_org;' },
  { name: 'concorrência: versão de cenário sem trava', file: 'pr_scenarios_analysis', suite: 'conc', nth: 1, find: 'select * into sc from public.pricing_scenarios where id = p_scenario and organization_id = p_org for update;', replace: 'select * into sc from public.pricing_scenarios where id = p_scenario and organization_id = p_org;' },
  { name: 'concorrência: confirmação de importação sem trava', file: 'pr_import', suite: 'conc', nth: 2, find: 'select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;', replace: 'select * into j from public.import_jobs where id = p_job and organization_id = p_org;' },
  { name: 'concorrência: publicação de lista sem trava', file: 'pr_lists', suite: 'conc', find: 'select * into v from public.price_list_versions where id = p_version and organization_id = p_org for update;\n  if not found then raise exception \'versão da lista não encontrada\' using errcode = \'P0002\'; end if;\n  if v.status = \'published\'', replace: 'select * into v from public.price_list_versions where id = p_version and organization_id = p_org;\n  if not found then raise exception \'versão da lista não encontrada\' using errcode = \'P0002\'; end if;\n  if v.status = \'published\'' },
  // --- motor TypeScript
  { name: 'motor: arredondamento de centavos para baixo', ts: 'lib/pricing/engine/decimal.ts', suite: 'unit', find: 'const n = value.toDecimalPlaces(0, D.ROUND_HALF_UP);', replace: 'const n = value.toDecimalPlaces(0, D.ROUND_DOWN);' },
  { name: 'motor: cenário inviável devolve preço', ts: 'lib/pricing/engine/solve.ts', suite: 'unit', find: 'if (denominator.lte(0)) continue;', replace: 'if (denominator.eq(0)) continue;' },
  { name: 'motor: solução sem verificação pelo modelo contínuo', ts: 'lib/pricing/engine/solve.ts', suite: 'unit', find: 'if (result.minus(mr.mul(R)).abs().gt(EPS)) continue;', replace: '' },
  { name: 'motor: «para cima» vira «para baixo»', ts: 'lib/pricing/engine/solve.ts', suite: 'unit', find: 'const up = exact.ceil();', replace: 'const up = exact.floor();' },
  { name: 'motor: arredondamento para cima não garante a meta', ts: 'lib/pricing/engine/solve.ts', suite: 'unit', find: 'while (!judged.meets && bumped < 200)', replace: 'while (false)' },
  { name: 'motor: preço líquido ignora taxas sobre o preço', ts: 'lib/pricing/engine/evaluate.ts', suite: 'unit', find: 'const net = D.max(0, revenue.minus(priceFees));', replace: 'const net = revenue;' },
  { name: 'motor: teto de taxa ignorado', ts: 'lib/pricing/engine/evaluate.ts', suite: 'unit', find: "if (p.max && v.gt(p.max)) { v = p.max; capped = 'max'; }", replace: '' },
  { name: 'motor: markup com custo-base zero', ts: 'lib/pricing/engine/evaluate.ts', suite: 'unit', find: 'const markup = base.gt(0) ?', replace: 'const markup = base.gte(0) ?' },
  { name: 'motor: desconto de 100 % aceito', ts: 'lib/pricing/engine/discount.ts', suite: 'unit', find: 'if (p.lt(0) || p.gte(100)) throw', replace: 'if (p.lt(0) || p.gt(100)) throw' },
  { name: 'motor: custo desconhecido vira zero', ts: 'lib/pricing/engine/costs.ts', suite: 'unit', find: 'unitOf.set(c.id, null); directKnown = false; continue;', replace: 'unitOf.set(c.id, new D(0)); continue;' },
  { name: 'motor: precedência invertida', ts: 'lib/pricing/engine/policy.ts', suite: 'unit', find: "['item_channel', 'item', 'category_channel', 'category', 'channel', 'global'];", replace: "['global', 'channel', 'category', 'category_channel', 'item', 'item_channel'];" },
  { name: 'motor: contribuição negativa não classificada', ts: 'lib/pricing/engine/risk.ts', suite: 'unit', find: 'if (ev.contributionCents < 0) return', replace: 'if (false) return' },
  { name: 'motor: conflito de políticas vira soma silenciosa', ts: 'lib/pricing/engine/policy.ts', suite: 'unit', find: "if (hits.length > 1) throw new PricingError('policy_conflict',", replace: "if (hits.length > 99) throw new PricingError('policy_conflict'," },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const cmd = suite === 'unit'
      ? [join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/unit/pricing-engine.test.ts', 'tests/unit/pricing-costs.test.ts', 'tests/unit/pricing-policy-risk.test.ts']
      : [join(dir, 'scripts', SCRIPT[suite])];
    const p = spawn(process.execPath, cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function applyMutation(path, mutate) {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const parts = text.split(mutate.find);
  const nth = mutate.nth ?? 1;
  if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
  if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
  if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
  writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
}

function workspace(label, mutate, suite) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-pr-mut-${label}-`));
  if (suite === 'unit') {
    for (const d of ['lib', 'tests', 'app', 'components']) cpSync(join(root, d), join(dir, d), { recursive: true });
    for (const f of ['vitest.config.ts', 'tsconfig.json', 'package.json']) cpSync(join(root, f), join(dir, f));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    if (mutate) applyMutation(join(dir, mutate.ts), mutate);
    return dir;
  }
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    applyMutation(join(dir, 'supabase', 'migrations', f), mutate);
  }
  return dir;
}

const suitesNeeded = new Set(M.filter((m) => !only || m.name.includes(only)).map((m) => m.suite ?? 'db'));
for (const suite of suitesNeeded) {
  const base = workspace(`base-${suite}`, null, suite);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    let dir;
    try {
      dir = workspace(String(next), m, m.suite ?? 'db');
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, m.suite ?? 'db');
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length - broken.length}/${todo.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);

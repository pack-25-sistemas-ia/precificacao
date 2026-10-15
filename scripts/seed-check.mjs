#!/usr/bin/env node
// Aplica migrações + supabase/seed.sql num Postgres descartável (Docker) e mostra o ERRO COM CONTEXTO, sem precisar subir o Supabase inteiro.
// Depois do seed, confere invariantes dos dados de demonstração (contagens, estados, imutabilidade religada).
// Uso: node scripts/seed-check.mjs   (requer Docker; banco sem porta publicada)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-pr-seed-${randomBytes(4).toString('hex')}`;
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });
const psql = (sql, label) => {
  const r = docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core'], { input: sql });
  if (r.status !== 0) { console.error(`FALHOU em ${label}:\n${r.stderr}`); return null; }
  return r.stdout.trim();
};

let ok = false;
try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', 'postgres:17-alpine']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  const files = ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)];
  // pgcrypto como no Supabase: schema «extensions» (o seed usa extensions.crypt)
  if (psql('create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;', 'pgcrypto') === null) throw new Error('pgcrypto');
  // o harness tem um auth.users mínimo; o seed insere como no Supabase real: completa as colunas e a tabela de identidades
  const authExtra = ['instance_id uuid', 'aud text', 'role text', 'encrypted_password text', 'email_confirmed_at timestamptz', 'raw_app_meta_data jsonb', 'raw_user_meta_data jsonb', 'created_at timestamptz', 'updated_at timestamptz', 'confirmation_token text', 'email_change text', 'email_change_token_new text', 'recovery_token text'];
  const fixAuth = () => psql(authExtra.map((c) => `alter table auth.users add column if not exists ${c};`).join(' ') + ' create table if not exists auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);', 'auth');
  for (const f of files) { if (psql(readFileSync(join(dbDir, f), 'utf8'), f) === null) throw new Error(f); if (f === 'tests/00_harness.sql' && fixAuth() === null) throw new Error('auth'); }
  if (psql(readFileSync(join(dbDir, 'seed.sql'), 'utf8'), 'seed.sql') === null) throw new Error('seed');
  const q = (sql) => Number(psql(sql, sql.slice(0, 40)));
  const checks = [
    ['itens cadastrados', q('select count(*) from public.pricing_items'), (n) => n === 55],
    ['versões de custo', q('select count(*) from public.cost_model_versions'), (n) => n > 100],
    ['itens com mais de uma versão de custo', q('select count(*) from (select item_id from public.cost_model_versions group by item_id having count(*) > 1) x'), (n) => n > 20],
    ['preços publicados (eventos)', q('select count(*) from public.price_change_events'), (n) => n > 150],
    ['solicitações pendentes', q("select count(*) from public.price_change_requests where status = 'pending'"), (n) => n >= 3],
    ['solicitação aprovada aguardando publicação', q("select count(*) from public.price_change_requests where status = 'approved'"), (n) => n >= 1],
    ['solicitação rejeitada e cancelada', q("select count(distinct status) from public.price_change_requests where status in ('rejected', 'cancelled')"), (n) => n === 2],
    ['políticas publicadas', q("select count(*) from public.pricing_policies where status = 'published'"), (n) => n === 5],
    ['listas: versão publicada e pendente', q("select count(distinct status) from public.price_list_versions where status in ('published', 'pending')"), (n) => n === 2],
    ['cenários', q('select count(*) from public.pricing_scenarios'), (n) => n === 5],
    ['vendas observadas', q('select count(*) from public.sales_observations'), (n) => n > 400],
    ['item sem custo existe e não tem versão', q("select count(*) from public.pricing_items i where sku = 'ELE-099' and not exists (select 1 from public.cost_model_versions v where v.item_id = i.id)"), (n) => n === 1],
    ['gatilhos de imutabilidade religados', q("select count(*) from pg_trigger where tgname in ('append_cost_model_versions', 'append_price_change_events', 'request_guard') and tgenabled = 'O'"), (n) => n === 3],
  ];
  ok = true;
  for (const [label, n, test] of checks) { const pass = test(n); console.log(`  ${pass ? 'PASS' : 'FALHOU'}: ${label} (${n})`); if (!pass) ok = false; }
} catch (e) {
  console.error(String(e.message ?? e));
} finally {
  docker(['rm', '-f', name]);
}
console.log(ok ? 'SEED: OK' : 'SEED: FALHA');
process.exit(ok ? 0 : 1);

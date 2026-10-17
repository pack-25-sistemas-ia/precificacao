import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL, apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { DEMO, api, apiJson, demoLogin, demoToken, norm } from './pr-helpers';

// Cenários de segurança (§28) contra o Supabase real: empresa A (dados de demonstração) × empresa B (criada aqui, com MFA).
// Pré-requisito: `supabase db reset` recente + app em produção. Este arquivo MUDA dados de demonstração (publica uma solicitação aprovada e decide uma pendente).
test.describe.configure({ mode: 'serial' });

let manager = '', analyst = '', viewer = '', ownerAal1 = '', tokenB = '';
let orgA = '', orgB = '', chLoja = '', chMkb = '';
let itemNoCost = '', itemAny = '', reqApproved = '', reqPending = '';
let bContext: Awaited<ReturnType<import('@playwright/test').Browser['newContext']>>;

const rpc = (token: string, fn: string, body: Record<string, unknown>) => api(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
async function expectDenied(res: Response, label: string) {
  const body = await res.text();
  expect(res.status, `${label}: deveria ser negado (${body.slice(0, 140)})`).toBeGreaterThanOrEqual(400);
  expect(body, `${label}: a função existe e a negação veio do banco`).not.toMatch(/PGRST202|Could not find the function/);
  return body;
}
async function expectNoEffect(res: Response, label: string) {
  if (res.status >= 400) return;
  expect(await res.json(), `${label}: nada deve ser afetado`).toEqual([]);
}

test('preparação: sessões da empresa A (gestor, analista, consulta, dono sem 2ª etapa) e da empresa B (com MFA)', async ({ browser }) => {
  manager = await demoToken(DEMO.manager); analyst = await demoToken(DEMO.analyst); viewer = await demoToken(DEMO.viewer); ownerAal1 = await demoToken(DEMO.owner);
  const chans = await apiJson<Array<{ id: string; name: string; organization_id: string }>>(manager, 'sales_channels?select=id,name,organization_id');
  orgA = chans[0]!.organization_id;
  chLoja = chans.find((c) => c.name === 'Loja física')!.id;
  chMkb = chans.find((c) => c.name === 'Marketplace Beta')!.id;
  itemNoCost = (await apiJson<Array<{ id: string }>>(manager, 'pricing_items?select=id&sku=eq.ELE-099'))[0]!.id;
  itemAny = (await apiJson<Array<{ id: string }>>(manager, 'pricing_items?select=id&sku=eq.ELE-001'))[0]!.id;
  reqApproved = (await apiJson<Array<{ id: string }>>(manager, 'price_change_requests?select=id&status=eq.approved&limit=1'))[0]!.id;
  reqPending = (await apiJson<Array<{ id: string }>>(manager, 'price_change_requests?select=id&status=eq.pending&order=requested_at.asc&limit=1'))[0]!.id;

  const email = uniqueEmail('prB');
  await apiSignUp(email);
  bContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const page = await bContext.newPage();
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, 'Empresa B Preços Ltda');
  tokenB = await apiAal2Token(await apiLogin(email), secret);
  orgB = (await apiJson<Array<{ organization_id: string }>>(tokenB, 'organization_members?select=organization_id'))[0]!.organization_id;
  expect(orgB).not.toBe(orgA);
});

test('1 · isolamento: a empresa B não lê custos, preços, taxas, políticas, listas, cenários nem vendas da A', async () => {
  for (const t of ['pricing_items', 'cost_components', 'cost_model_versions', 'channel_fee_rules', 'tax_profiles', 'pricing_policies', 'pricing_policy_versions', 'pricing_rule_assignments', 'price_lists', 'price_list_versions',
    'price_list_items', 'pricing_scenarios', 'pricing_scenario_versions', 'pricing_scenario_items', 'price_change_requests', 'price_change_events', 'sales_observations', 'item_channel_prices', 'import_jobs', 'pr_notifications']) {
    const res = await api(tokenB, `${t}?select=*&limit=5`);
    expect(res.status, `B lendo ${t}`).toBe(200);
    expect(await res.json(), `B lendo ${t}`).toEqual([]);
  }
  await expectDenied(await rpc(tokenB, 'pr_item_context', { p_org: orgA, p_item: itemAny, p_channel: chLoja, p_date: null }), 'B lendo contexto de custo da A');
  await expectDenied(await rpc(tokenB, 'pr_analysis_inputs', { p_org: orgA }), 'B lendo análise da A');
  await expectDenied(await rpc(tokenB, 'pr_sales_summary', { p_org: orgA, p_from: '2026-01-01', p_to: '2026-12-31' }), 'B lendo vendas da A');
  expect((await rpc(tokenB, 'pr_analysis_inputs', { p_org: orgB })).status, 'controle: B lê a própria análise').toBe(200);
});

test('2 · analista não aprova nem publica; consulta não altera taxas, políticas nem cadastros', async () => {
  await expectDenied(await rpc(analyst, 'pr_publish_price_change', { p_org: orgA, p_request: reqApproved }), 'analista publicando');
  await expectDenied(await rpc(analyst, 'pr_review_price_change', { p_org: orgA, p_request: reqPending, p_approve: true, p_note: null }), 'analista aprovando');
  await expectDenied(await rpc(analyst, 'pr_publish_policy', { p_org: orgA, p_policy: randomUUID() }), 'analista publicando política');
  await expectDenied(await rpc(viewer, 'pr_request_price_change', { p_org: orgA, p_item: itemAny, p_channel: chLoja, p_price: 5000, p_justification: 'consulta tentando', p_source: 'manual' }), 'consulta propondo');
  await expectNoEffect(await api(viewer, `channel_fee_rules?channel_id=eq.${chLoja}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ rate_decimal: 0.01 }) }), 'consulta alterando taxa');
  await expectDenied(await api(viewer, 'pricing_items', { method: 'POST', body: JSON.stringify({ organization_id: orgA, item_type: 'product', sku: 'HACK-1', name: 'x' }) }), 'consulta cadastrando item');
  await expectDenied(await api(analyst, 'sales_channels', { method: 'POST', body: JSON.stringify({ organization_id: orgA, name: 'Canal invasor' }) }), 'analista criando canal');
  await expectNoEffect(await api(analyst, 'pr_settings', { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ segregation_of_duties: false }) }), 'analista desligando a segregação');
  expect((await apiJson<Array<{ segregation_of_duties: boolean }>>(manager, 'pr_settings?select=segregation_of_duties'))[0]!.segregation_of_duties).toBe(true);
});

test('3–4 · taxa/tributo inválidos: percentual > 100, soma de tributos ≥ 100 % e tributo sem origem são recusados no banco', async () => {
  await expectDenied(await api(manager, 'channel_fee_rules', { method: 'POST', body: JSON.stringify({ organization_id: orgA, channel_id: chLoja, name: 'Absurda', fee_type: 'other', basis: 'price', rate_decimal: 150 }) }), 'taxa de 150 %');
  await expectDenied(await api(manager, 'channel_fee_rules', { method: 'POST', body: JSON.stringify({ organization_id: orgA, channel_id: chLoja, name: 'Mista', fee_type: 'other', basis: 'fixed_unit', rate_decimal: 5, fixed_amount_cents: 100 }) }), 'taxa fixa com percentual');
  // perfil tributário: só administrador (dono com 2ª etapa na empresa B para o teste positivo)
  const bad = (cfg: unknown) => api(tokenB, 'tax_profiles', { method: 'POST', body: JSON.stringify({ organization_id: orgB, name: `P-${randomUUID().slice(0, 6)}`, configuration_json: cfg }) });
  const ok = await bad({ taxes: [{ name: 'X', rate_pct: 5, basis: 'price', source: 'contador' }] });
  expect(ok.status, await ok.clone().text()).toBeLessThan(300);
  expect(await (await bad({ taxes: [{ name: 'X', rate_pct: 60, basis: 'price', source: 's' }, { name: 'Y', rate_pct: 40, basis: 'price', source: 's' }] })).text()).toMatch(/100/);
  expect(await (await bad({ taxes: [{ name: 'X', rate_pct: 5, basis: 'price' }] })).text()).toMatch(/origem/);
  await expectDenied(await api(manager, 'tax_profiles', { method: 'POST', body: JSON.stringify({ organization_id: orgA, name: 'Gestor tentando', configuration_json: { taxes: [] } }) }), 'gestor criando perfil tributário');
});

test('5–6 · custo-base zero: markup «não calculável»; desconto que zera a contribuição é sinalizado (simulador em modo livre)', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/simulador');
  await page.getByLabel('Custo variável unitário (R$)').fill('0');
  await page.getByLabel('Preço atual (R$)').fill('10,00');
  await expect(page.locator('main').getByText('Markup', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText('não calculável');
  await expect(page.locator('main').getByText('Margem de contribuição', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText('100,00 %');
  await page.getByLabel('Custo variável unitário (R$)').fill('60,00');
  await page.getByLabel('Outras taxas sobre o preço (%)').fill('10');
  await page.getByLabel('Preço atual (R$)').fill('100,00');
  await page.getByLabel('Desconto (%)').fill('50');
  await expect(page.getByText('Com este desconto a contribuição fica negativa.')).toBeVisible();
});

test('7–8 · requisição repetida publica uma vez; duas decisões concorrentes têm um vencedor só', async () => {
  const first = await rpc(manager, 'pr_publish_price_change', { p_org: orgA, p_request: reqApproved });
  expect(first.status, await first.clone().text()).toBeLessThan(300);
  const again = await expectDenied(await rpc(manager, 'pr_publish_price_change', { p_org: orgA, p_request: reqApproved }), 'segunda publicação');
  expect(again).toMatch(/já publicada/);
  expect((await apiJson<Array<{ id: string }>>(manager, `price_change_events?select=id&request_id=eq.${reqApproved}`)).length).toBe(1);

  const calls = await Promise.all([true, false, true, false, true, false].map((approve) => rpc(manager, 'pr_review_price_change', { p_org: orgA, p_request: reqPending, p_approve: approve, p_note: 'decisão concorrente de teste' })));
  const winners = calls.filter((r) => r.status < 300).length;
  expect(winners, 'só uma decisão vale').toBe(1);
  const st = (await apiJson<Array<{ status: string }>>(manager, `price_change_requests?select=status&id=eq.${reqPending}`))[0]!.status;
  expect(['approved', 'rejected']).toContain(st);
});

test('9 · cenário histórico é imutável: versões e itens não são editáveis nem apagáveis; arquivado não recebe versão', async () => {
  const [v] = await apiJson<Array<{ id: string; scenario_id: string }>>(manager, 'pricing_scenario_versions?select=id,scenario_id&limit=1');
  await expectNoEffect(await api(manager, `pricing_scenario_versions?id=eq.${v!.id}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ output_snapshot_json: {} }) }), 'editar versão de cenário');
  await expectNoEffect(await api(manager, `pricing_scenario_versions?id=eq.${v!.id}`, { method: 'DELETE', headers: { prefer: 'return=representation' } }), 'apagar versão de cenário');
  await expectDenied(await api(manager, 'pricing_scenario_items', { method: 'POST', body: JSON.stringify({ organization_id: orgA, scenario_version_id: v!.id, pricing_item_id: itemAny, channel_id: chLoja, input_price_cents: 1, direct_cost_cents: 1, fees_cents: 1, contribution_cents: 999999 }) }), 'inserir resultado de cenário');
  const arch = await rpc(manager, 'pr_archive_scenario', { p_org: orgA, p_scenario: v!.scenario_id });
  expect(arch.status).toBeLessThan(300);
  await expectDenied(await rpc(manager, 'pr_save_scenario', { p_org: orgA, p_scenario: v!.scenario_id, p_name: 'x', p_description: null, p_items: [{ item_id: itemAny, channel_id: chLoja, price_cents: 3000 }], p_engine_version: '1.0.0' }), 'versão em cenário arquivado');
});

test('10 · importação não altera preço sem aprovação (preço importado vira solicitação pendente)', async () => {
  const before = (await apiJson<Array<{ price_cents: number }>>(manager, `item_channel_prices?select=price_cents&item_id=eq.${itemAny}&channel_id=eq.${chMkb}`))[0];
  const rows = [{ sku: 'ELE-001', channel: 'Marketplace Beta', price: '123456' }];
  const hash = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const prev = await rpc(manager, 'pr_create_import', { p_org: orgA, p_type: 'prices', p_file_name: 'p.csv', p_hash: hash, p_rows: rows });
  const pj = await prev.json() as { import_id: string; valid: number };
  const done = await rpc(manager, 'pr_commit_import', { p_org: orgA, p_job: pj.import_id });
  expect(done.status, await done.clone().text()).toBeLessThan(300);
  const after = (await apiJson<Array<{ price_cents: number }>>(manager, `item_channel_prices?select=price_cents&item_id=eq.${itemAny}&channel_id=eq.${chMkb}`))[0];
  expect(after?.price_cents).toBe(before?.price_cents);
  const reqs = await apiJson<Array<{ status: string; source: string; proposed_price_cents: number }>>(manager, `price_change_requests?select=status,source,proposed_price_cents&item_id=eq.${itemAny}&channel_id=eq.${chMkb}&status=eq.pending`);
  expect(reqs.some((r) => r.source === 'import' && r.proposed_price_cents === 123456)).toBe(true);
  // o analista não importa vendas nem taxas
  await expectDenied(await rpc(analyst, 'pr_create_import', { p_org: orgA, p_type: 'sales', p_file_name: 's.csv', p_hash: hash.replace(/./, 'a'), p_rows: [{ sku: 'ELE-001' }] }), 'analista importando vendas');
});

test('11 · valores calculados pelo navegador não valem: resultado forjado é recusado e sugestão forjada não é «verificada»', async () => {
  await expectDenied(await api(manager, 'price_change_requests', { method: 'POST', body: JSON.stringify({ organization_id: orgA, item_id: itemAny, proposed_price_cents: 1, justification: 'forjado', requested_by: randomUUID(), status: 'published' }) }), 'inserir solicitação já publicada');
  await expectDenied(await api(manager, 'pricing_items', { method: 'POST', body: JSON.stringify({ organization_id: orgA, item_type: 'product', sku: 'FORJ-1', name: 'x', current_base_price_cents: 1 }) }), 'gravar preço direto');
  const r = await rpc(manager, 'pr_save_scenario', { p_org: orgA, p_scenario: null, p_name: `Forjado ${randomUUID().slice(0, 6)}`, p_description: null, p_items: [{ item_id: itemAny, channel_id: chLoja, price_cents: 5000, suggested_price_cents: 9999999 }], p_engine_version: '1.0.0' });
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  const out = await r.json() as { version_id: string };
  const [it] = await apiJson<Array<{ suggestion_verified: boolean | null; contribution_cents: number; fees_cents: number }>>(manager, `pricing_scenario_items?select=suggestion_verified,contribution_cents,fees_cents&scenario_version_id=eq.${out.version_id}`);
  expect(it!.suggestion_verified, 'sugestão absurda não é verificada').toBe(false);
  expect(it!.contribution_cents).toBeLessThan(5000); // contribuição calculada pelo banco com preço 5000, nunca o valor do cliente
});

test('12 · exportação de outra empresa não revela custos da A', async () => {
  const page = await bContext.newPage();
  const res = await page.request.get('/api/export/composicao-custos');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toContain('ELE-001');
  expect(body).not.toContain('Compra do lote');
  const pr = await page.request.get('/api/export/itens');
  expect(await pr.text()).not.toContain('PAP-001');
  await page.close();
});

test('13 · conflito de precedência: segunda atribuição no mesmo escopo é recusada pelo banco', async () => {
  const [a] = await apiJson<Array<{ policy_id: string }>>(manager, 'pricing_rule_assignments?select=policy_id&item_id=is.null&category_id=is.null&channel_id=is.null&limit=1');
  const res = await api(manager, 'pricing_rule_assignments', { method: 'POST', body: JSON.stringify({ organization_id: orgA, policy_id: a!.policy_id }) });
  const body = await expectDenied(res, 'atribuição global duplicada');
  expect(body).toMatch(/exclusion|conflict|23P01/i);
});

test('14 · lista de preços da outra empresa: nem lista, nem versão, nem a página', async () => {
  const lists = await apiJson<Array<{ id: string }>>(manager, 'price_lists?select=id&limit=1');
  const page = await bContext.newPage();
  const res = await page.goto(`/listas-precos/${lists[0]!.id}`);
  expect(res?.status()).toBe(404);
  await page.close();
  await expectDenied(await rpc(tokenB, 'pr_validate_list_version', { p_org: orgA, p_version: randomUUID() }), 'B validando versão da A');
});

test('15 · custo ausente nunca vira zero: item sem versão não entra em cenário, proposta nem lista; painel mostra «custo incompleto»', async ({ page }) => {
  const body = await expectDenied(await rpc(manager, 'pr_save_scenario', { p_org: orgA, p_scenario: null, p_name: `Sem custo ${randomUUID().slice(0, 6)}`, p_description: null, p_items: [{ item_id: itemNoCost, channel_id: chLoja, price_cents: 3000 }], p_engine_version: '1.0.0' }), 'cenário com item sem custo');
  expect(body).toMatch(/sem versão de custo/);
  expect(await expectDenied(await rpc(manager, 'pr_request_price_change', { p_org: orgA, p_item: itemNoCost, p_channel: chLoja, p_price: 3000, p_justification: 'item sem custo', p_source: 'manual' }), 'proposta sem custo')).toMatch(/sem versão de custo/);
  const ctx = await (await rpc(manager, 'pr_item_context', { p_org: orgA, p_item: itemNoCost, p_channel: chLoja, p_date: null })).json() as { cost: unknown };
  expect(ctx.cost, 'o contexto não inventa custo zero').toBeNull();
  await demoLogin(page, DEMO.manager);
  await page.goto('/custos?situacao=sem_versao');
  await expect(page.getByText('ELE-099').first()).toBeVisible();
  await page.goto('/dashboard?risk=incomplete_cost');
  await expect(page.locator('main')).toContainText('Custo incompleto');
  expect(norm(await page.locator('main').innerText())).toContain('Custo incompleto');
});

test('MFA e acesso anônimo: o dono sem 2ª etapa é barrado no banco; anônimo não executa funções do motor', async () => {
  const body = await expectDenied(await rpc(ownerAal1, 'pr_request_price_change', { p_org: orgA, p_item: itemAny, p_channel: chLoja, p_price: 5000, p_justification: 'sem segunda etapa', p_source: 'manual' }), 'dono sem MFA');
  expect(body).toMatch(/duas etapas/i);
  const args: Record<string, Record<string, unknown>> = {
    pr_request_price_change: { p_org: orgA, p_item: itemAny, p_channel: chLoja, p_price: 5000, p_justification: 'anônimo', p_source: 'manual' },
    pr_publish_price_change: { p_org: orgA, p_request: reqApproved },
    pr_save_cost_version: { p_org: orgA, p_item: itemAny, p_note: null },
    pr_analysis_inputs: { p_org: orgA },
    pr_item_context: { p_org: orgA, p_item: itemAny, p_channel: chLoja, p_date: null },
  };
  for (const [fn, b] of Object.entries(args)) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await expectDenied(res, `anônimo em ${fn}`);
  }
  const t = await fetch(`${SUPABASE_URL}/rest/v1/cost_model_versions?select=*&limit=1`, { headers: { apikey: ANON_KEY } });
  expect([401, 403]).toContain(t.status);
  const anonPage = await fetch(`${process.env.E2E_BASE_URL ?? 'http://localhost:3123'}/api/export/itens`, { redirect: 'manual' });
  expect([302, 307, 401, 403]).toContain(anonPage.status);
});

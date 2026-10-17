import { expect, test } from '@playwright/test';
import { DEMO, apiJson, demoLogin, demoToken, expectNoServerError, norm } from './pr-helpers';
import { SUPABASE_URL } from './helpers';

// Dados de demonstração (supabase/seed.sql). Pré-requisito: `supabase db reset` recém-executado e o app em produção na porta do site_url.
test.describe.configure({ mode: 'serial' });

const PAGES = [
  ['/dashboard', 'Painel de precificação'], ['/produtos', 'Produtos'], ['/servicos', 'Serviços'], ['/custos', 'Composição de custos'], ['/canais', 'Canais de venda'], ['/taxas', 'Taxas, comissões e tributos informados'],
  ['/regras', 'Políticas de preço'], ['/listas-precos', 'Listas de preços'], ['/simulador', 'Simulador de preços'], ['/simulador?aba=descontos', 'Simulador de descontos'], ['/cenarios', 'Cenários'], ['/aprovacoes', 'Aprovações de preço'],
  ['/relatorios', 'Relatórios'], ['/importacoes', 'Importações (CSV)'], ['/notificacoes', 'Avisos'], ['/configuracoes', 'Configurações de preços'],
] as const;

test('gestor: todas as telas abrem com dados reais e sem erro; os 17 relatórios abrem', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const [path, heading] of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading, level: 1 }).first(), path).toBeVisible();
    await expectNoServerError(page, path);
  }
  await page.goto('/relatorios');
  const links = await page.locator('a[href^="/relatorios?r="]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));
  expect(links).toHaveLength(17);
  for (const href of links) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(200);
    await expectNoServerError(page, href);
    await expect(page.getByRole('link', { name: 'Exportar CSV' }), href).toBeVisible();
  }
});

test('painel: indicadores e gráficos presentes, com números que fecham com os dados', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/dashboard?period=180d');
  // espera o painel terminar de carregar antes de ler o texto (senão a leitura pega «Carregando…»)
  await expect(page.getByText('Itens analisados', { exact: true }).first()).toBeVisible();
  const text = norm(await page.locator('main').innerText());
  for (const k of ['Itens analisados', 'Margem média simples', 'Abaixo da meta', 'Contribuição negativa', 'Custo incompleto', 'Diferença média de preço', 'Preços alterados no período', 'Cenários salvos', 'Variação de custo', 'Itens por canal']) expect(text, k).toContain(k);
  for (const g of ['Margem por categoria', 'Itens por faixa de margem', 'Preço atual × preço recomendado', 'Evolução dos custos', 'Comparação entre canais', 'Composição do preço', 'Maiores distâncias da meta', 'Cenários comparativos', 'Evolução dos preços publicados', 'Margem por produto ou serviço']) {
    await expect(page.getByRole('region', { name: g }), g).toBeVisible();
  }
  // «Cenários salvos» = cenários ativos no banco; «Custo incompleto» conta os 2 itens de demonstração sem custo completo
  const token = await demoToken(DEMO.manager);
  const sc = await apiJson<Array<{ id: string }>>(token, 'pricing_scenarios?select=id&status=eq.active');
  await expect(page.getByText('Cenários salvos', { exact: true }).locator('xpath=..').getByText(String(sc.length), { exact: true }).first()).toBeVisible();
  const incomplete = text.match(/Custo incompleto\s*(\d+)/);
  expect(Number(incomplete?.[1])).toBe(2);
});

test('margem de um item conferida por recálculo independente (fração exata) a partir do banco', async ({ page }) => {
  const token = await demoToken(DEMO.manager);
  const [item] = await apiJson<Array<{ id: string }>>(token, 'pricing_items?select=id&sku=eq.PAP-006');
  const [ch] = await apiJson<Array<{ id: string; tax_profile_id: string | null }>>(token, 'sales_channels?select=id,tax_profile_id&name=eq.Loja física');
  const [version] = await apiJson<Array<{ direct_unit_cost_cents: number }>>(token, `cost_model_versions?select=direct_unit_cost_cents&item_id=eq.${item!.id}&order=version_number.desc&limit=1`);
  const [price] = await apiJson<Array<{ price_cents: number }>>(token, `item_channel_prices?select=price_cents&item_id=eq.${item!.id}&channel_id=eq.${ch!.id}`);
  const fees = await apiJson<Array<{ basis: string; rate_decimal: number | null }>>(token, `channel_fee_rules?select=basis,rate_decimal&channel_id=eq.${ch!.id}&active=eq.true`);
  const [tp] = await apiJson<Array<{ configuration_json: { taxes: Array<{ rate_pct: number }> } }>>(token, `tax_profiles?select=configuration_json&id=eq.${ch!.tax_profile_id}`);
  expect(price, 'o item tem preço publicado no canal').toBeTruthy();
  const rev = price!.price_cents;
  const cost = Math.round(version!.direct_unit_cost_cents);
  const pctSum = fees.filter((f) => f.basis === 'price').map((f) => Math.round(rev * Number(f.rate_decimal) / 100 + 1e-9));
  const taxes = (tp?.configuration_json.taxes ?? []).map((t) => Math.round(rev * t.rate_pct / 100 + 1e-9));
  const contribution = rev - cost - [...pctSum, ...taxes].reduce((s, x) => s + x, 0);
  const margin = (contribution / rev * 100).toFixed(2).replace('.', ',');
  await demoLogin(page, DEMO.manager);
  await page.goto(`/produtos/${item!.id}`);
  const row = page.getByRole('row', { name: /Loja física/ }).first();
  await expect(row).toContainText(`${margin} %`);
});

test('analista: propõe e cadastra, mas não aprova, não publica, não exporta e não vê configurações', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto('/aprovacoes');
  await expect(page.getByRole('button', { name: 'Aprovar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publicar preço' })).toHaveCount(0);
  await page.goto('/relatorios?r=margens-produto');
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  const res = await page.request.get('/api/export/margens-produto');
  expect(res.status()).toBe(403);
  await page.goto('/regras');
  await expect(page.getByRole('button', { name: 'Criar política' })).toHaveCount(0);
  await page.goto('/taxas');
  await expect(page.getByRole('button', { name: 'Cadastrar taxa' })).toHaveCount(0);
  await page.goto('/produtos');
  await expect(page.getByText('Cadastrar produto')).toBeVisible();
});

test('consulta: lê tudo, não altera nada', async ({ page }) => {
  await demoLogin(page, DEMO.viewer);
  for (const [path] of PAGES.slice(0, 9)) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  await page.goto('/produtos');
  await expect(page.getByText('Cadastrar produto')).toHaveCount(0);
  await page.goto('/aprovacoes');
  await expect(page.getByRole('button', { name: 'Aprovar' })).toHaveCount(0);
  const token = await demoToken(DEMO.viewer);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pr_request_price_change`, { method: 'POST', headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test('API anônima não lê nada', async () => {
  const anon = process.env.E2E_SUPABASE_ANON_KEY ?? '';
  for (const t of ['pricing_items', 'cost_model_versions', 'price_change_requests', 'sales_observations', 'channel_fee_rules']) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anon } });
    expect([401, 403], t).toContain(res.status);
  }
});

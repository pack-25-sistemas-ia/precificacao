import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { DEMO, demoLogin, expectNoServerError, norm } from './pr-helpers';

// Fluxo operacional numa organização NOVA (sem seed), com MFA do proprietário, contra o Supabase real; depois, o fluxo de aprovação entre pessoas diferentes (usuários de demonstração).
// Números conferidos à mão: custo R$ 22,00, comissão 15 %, margem-alvo 30 % → preço R$ 40,00 (22 ÷ 0,55); contribuição R$ 12,00.
test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  page = await context.newPage();
});
test.afterAll(async () => { await page.context().close(); });

const email = uniqueEmail('pr');
let itemUrl = '';

const form = (p: Page, button: string | RegExp): Locator => p.locator('form', { has: p.getByRole('button', { name: button }) }).first();
async function text(p: Page) {
  await expect(p.locator('main')).not.toHaveText(/^\s*Carregando…\s*$/); // não ler o texto enquanto a página ainda carrega
  return norm(await p.locator('main').innerText());
}
async function open(p: Page, summary: string | RegExp) {
  const d = p.locator('details', { has: p.locator('summary', { hasText: summary }) }).first();
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').first().click();
}

test('cria conta, organização e entra com verificação em duas etapas; painel vazio orienta', async () => {
  await apiSignUp(email);
  await uiLogin(page, email);
  await onboardAndEnrollMfa(page, 'Distribuidora Preço Certo E2E Ltda');
  await expect(page.getByText('Comece cadastrando o que será precificado')).toBeVisible();
});

test('canal e taxa: percentual inválido é recusado; comissão de 15 % é cadastrada', async () => {
  await page.goto('/canais');
  await open(page, 'Criar canal');
  const f = form(page, 'Criar canal');
  await f.getByLabel('Nome', { exact: true }).fill('Marketplace A');
  await f.getByLabel('Tipo').selectOption({ label: 'Marketplace' });
  await f.getByRole('button', { name: 'Criar canal' }).click();
  await expect(page.getByText('Canal criado.').first()).toBeVisible();

  await page.goto('/taxas');
  await open(page, 'Cadastrar taxa');
  const t = form(page, 'Cadastrar taxa');
  await t.getByLabel('Canal', { exact: true }).selectOption({ label: 'Marketplace A' });
  await t.getByLabel('Nome da taxa').fill('Comissão');
  await t.getByLabel('Percentual (%)').fill('150');
  await t.getByRole('button', { name: 'Cadastrar taxa' }).click();
  await expect(page.getByText(/Percentual: informe um percentual entre 0 e 100/)).toBeVisible();
  await t.getByLabel('Percentual (%)').fill('15');
  await t.getByRole('button', { name: 'Cadastrar taxa' }).click();
  await expect(page.getByText(/Taxa cadastrada/).first()).toBeVisible();
  await page.goto('/taxas');
  await expect(page.getByRole('cell', { name: 'Comissão', exact: true }).first()).toBeVisible();
});

test('produto: SKU único; custo desconhecido NÃO é zero; versão de custo imutável com custo direto de R$ 22,00', async () => {
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  let f = form(page, 'Cadastrar');
  await f.getByLabel('SKU').fill('E2E-01');
  await f.getByLabel('Nome', { exact: true }).fill('Produto de teste');
  await f.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/);
  itemUrl = page.url();

  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  f = form(page, 'Cadastrar');
  await f.getByLabel('SKU').fill('e2e-01');
  await f.getByLabel('Nome', { exact: true }).fill('Repetido');
  await f.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await expect(page.getByText('Já existe um item com este SKU.')).toBeVisible();

  await page.goto(`${itemUrl}?aba=custos`);
  // sem componentes: não salva versão
  await form(page, 'Salvar versão do custo').getByRole('button', { name: 'Salvar versão do custo' }).click();
  await expect(page.getByText(/nenhum componente de custo direto informado/i)).toBeVisible();
  // compra do lote: R$ 2.000,00 por 100 un. = R$ 20,00 por unidade
  let c = form(page, 'Adicionar ao rascunho do custo');
  await c.getByLabel('Nome do componente').fill('Compra do lote');
  await c.getByLabel('Valor total (R$)').fill('2.000,00');
  await c.getByLabel('Quantidade que o valor cobre').fill('100');
  await c.getByRole('button', { name: 'Adicionar ao rascunho do custo' }).click();
  await expect(page.getByText('Componente adicionado ao rascunho do custo.').first()).toBeVisible();
  // embalagem SEM valor: desconhecido
  c = form(page, 'Adicionar ao rascunho do custo');
  await c.getByLabel('Nome do componente').fill('Embalagem');
  await c.getByRole('button', { name: 'Adicionar ao rascunho do custo' }).click();
  await expect(page.getByText(/SEM valor: fica como desconhecido/).first()).toBeVisible();
  await page.goto(`${itemUrl}?aba=custos`);
  await expect(page.getByText('Desconhecido').first()).toBeVisible();
  await form(page, 'Salvar versão do custo').getByRole('button', { name: 'Salvar versão do custo' }).click();
  await expect(page.getByText(/desconhecido não é zero/i)).toBeVisible();
  // informa a embalagem: R$ 2,00
  const row = page.getByRole('row', { name: /Embalagem/ });
  await row.getByLabel('Valor (R$)').fill('2,00');
  await row.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText(/Componente atualizado no rascunho/).first()).toBeVisible();
  await page.goto(`${itemUrl}?aba=custos`);
  await form(page, 'Salvar versão do custo').getByRole('button', { name: 'Salvar versão do custo' }).click();
  await expect(page.getByText('Versão de custo salva (imutável).').first()).toBeVisible();
  await page.goto(`${itemUrl}?aba=custos`);
  const t = await text(page);
  expect(t).toMatch(/Custo direto unitário\s*R\$ 22,00/);
  await expect(page.getByRole('cell', { name: 'v1', exact: true })).toBeVisible();
});

test('política: rascunho não vale; publicada e atribuída passa a valer; conflito no mesmo escopo é recusado', async () => {
  await page.goto('/regras');
  await open(page, 'Criar política');
  const f = form(page, 'Criar política');
  await f.getByLabel('Nome', { exact: true }).fill('Meta de 30');
  await f.getByLabel('Arredondamento do preço').selectOption({ label: 'Sempre para cima (garante a meta)' });
  await f.getByLabel('Margem-alvo (%)').fill('30');
  await f.getByLabel('Margem mínima (%)').fill('50');
  await f.getByRole('button', { name: 'Criar política' }).click();
  await expect(page.getByText('A margem mínima não pode superar a margem-alvo.')).toBeVisible();
  await f.getByLabel('Margem mínima (%)').fill('10');
  await f.getByRole('button', { name: 'Criar política' }).click();
  await expect(page.getByText(/Política criada como rascunho/).first()).toBeVisible();
  await page.goto('/regras');
  await page.getByRole('button', { name: 'Publicar versão' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Política publicada \(versão 1\)/).first()).toBeVisible();
  await page.goto('/regras');
  await open(page, 'Atribuir política');
  const a = form(page, 'Atribuir política');
  await a.getByLabel('Política').selectOption({ label: 'Meta de 30' });
  await a.getByRole('button', { name: 'Atribuir política' }).click();
  await expect(page.getByText('Atribuição criada.').first()).toBeVisible();
  await open(page, 'Atribuir política');
  const b = form(page, 'Atribuir política');
  await b.getByLabel('Política').selectOption({ label: 'Meta de 30' });
  await b.getByRole('button', { name: 'Atribuir política' }).click();
  await expect(page.getByText(/Já existe uma atribuição vigente neste mesmo escopo/)).toBeVisible();
});

test('simulador: preço para a meta de 30 % = R$ 40,00; margem 25 % = R$ 36,67; taxa inviável não devolve preço; desconto recalcula as taxas', async () => {
  await page.goto('/simulador');
  await page.getByLabel('Item (opcional)').selectOption({ label: 'E2E-01 — Produto de teste' });
  await page.getByLabel('Canal', { exact: true }).selectOption({ label: 'Marketplace A' });
  await page.getByRole('button', { name: 'Carregar' }).click();
  await expect(page.getByText(/Valores carregados de/)).toBeVisible();
  await page.getByLabel('Preço atual (R$)').fill('40,00');
  const main = page.locator('main');
  await expect(main).toContainText('R$ 22,00'); // custo variável total
  await expect(main.getByText('Preço para a margem-alvo').locator('xpath=following-sibling::p[1]')).toHaveText('R$ 40,00');
  await expect(main.getByText('Contribuição unitária', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText('R$ 12,00');
  await expect(main.getByText('Margem de contribuição', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText('30,00 %');
  await expect(main.getByText('Markup', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText(/81,82 %/);
  await page.getByLabel('Margem-alvo (%)').fill('25');
  await expect(main.getByText('Preço para a margem-alvo').locator('xpath=following-sibling::p[1]')).toHaveText('R$ 36,67');
  await page.getByLabel('Outras taxas sobre o preço (%)').fill('90');
  await expect(page.getByText('Cenário inviável.')).toBeVisible();
  await expect(main.getByText('Preço para a margem-alvo').locator('xpath=following-sibling::p[1]')).toHaveText('—');
  await page.getByLabel('Outras taxas sobre o preço (%)').fill('');
  await page.getByLabel('Margem-alvo (%)').fill('30');
  // desconto de 10 %: preço 36,00, taxa recalculada 5,40, contribuição 8,60 (e não 12,00 − 4,00)
  await page.getByLabel('Desconto (%)').fill('10');
  await expect(page.getByText('Efeito do desconto')).toBeVisible();
  const card = page.locator('section, div').filter({ has: page.getByText('Efeito do desconto') }).last();
  await expect(card).toContainText('R$ 36,00');
  await expect(card).toContainText('R$ 8,60');
  await expect(card).toContainText('23,89 %');
  await page.getByLabel('Desconto (%)').fill('100');
  await expect(page.getByText(/Desconto inválido|entre 0 % e 100 %/).first()).toBeVisible();
});

test('aprovação: quem propõe não aprova (segregação); desligada nas configurações, o fluxo propõe → aprova → publica uma vez', async () => {
  await page.goto(`${itemUrl}?aba=precos`);
  const f = form(page, 'Propor preço (vai para aprovação)');
  await f.getByLabel('Canal').selectOption({ label: 'Marketplace A' });
  await f.getByLabel('Preço proposto (R$)').fill('40,00');
  await f.getByLabel('Justificativa').fill('abc');
  await f.getByRole('button', { name: 'Propor preço (vai para aprovação)' }).click();
  await expect(page.getByText(/Justificativa: mínimo de 5 caracteres/)).toBeVisible();
  await f.getByLabel('Justificativa').fill('Preço de lançamento no marketplace');
  await f.getByRole('button', { name: 'Propor preço (vai para aprovação)' }).click();
  await expect(page.getByText(/Proposta enviada para aprovação/).first()).toBeVisible();

  await page.goto('/aprovacoes');
  await expect(page.getByText('Você propôs: outra pessoa precisa aprovar.')).toBeVisible();
  await page.goto('/configuracoes');
  const s = form(page, 'Salvar configurações');
  await s.getByLabel(/Segregação de funções/).uncheck();
  await s.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText(/Configurações salvas/).first()).toBeVisible();

  await page.goto('/aprovacoes');
  await expect(page.getByText(/segregação de funções está desligada/i)).toBeVisible();
  await page.getByLabel(/Observação/).first().fill('ok');
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('Alteração aprovada. Falta publicar.').first()).toBeVisible();
  await page.goto('/aprovacoes');
  await page.getByRole('button', { name: 'Publicar preço' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Preço publicado neste sistema/).first()).toBeVisible();

  await page.goto(itemUrl);
  const row = page.getByRole('row', { name: /Marketplace A/ }).first();
  await expect(row).toContainText('R$ 40,00');
  await expect(row).toContainText('30,00 %');
  await expect(row).toContainText('Dentro da meta');
  await page.goto(`${itemUrl}?aba=precos`);
  const hist = await text(page);
  expect(hist).toContain('Solicitação');
  // «Publicar» de novo não existe mais (solicitação já publicada)
  await page.goto('/aprovacoes');
  await expect(page.getByRole('button', { name: 'Publicar preço' })).toHaveCount(0);
});

test('cenário: salvo a partir do simulador; mudar a taxa depois NÃO altera o cenário salvo', async () => {
  await page.goto('/simulador');
  await page.getByLabel('Item (opcional)').selectOption({ label: 'E2E-01 — Produto de teste' });
  await page.getByLabel('Canal', { exact: true }).selectOption({ label: 'Marketplace A' });
  await page.getByRole('button', { name: 'Carregar' }).click();
  await expect(page.getByText(/Valores carregados de/)).toBeVisible();
  const f = form(page, 'Salvar cenário');
  await f.getByLabel('Nome do cenário').fill('Cenário base E2E');
  await f.getByRole('button', { name: 'Salvar cenário' }).click();
  await page.waitForURL(/\/cenarios\/[0-9a-f-]{36}$/);
  const url = page.url();
  let t = await text(page);
  expect(t).toContain('R$ 12,00'); // contribuição
  expect(t).toContain('30,00 %');
  // nova taxa de 5 % no canal DEPOIS do cenário salvo: o item passa a ter margem de 25 %, mas o cenário salvo continua com 30 %
  await page.goto('/taxas');
  await open(page, 'Cadastrar taxa');
  const tx = form(page, 'Cadastrar taxa');
  await tx.getByLabel('Canal', { exact: true }).selectOption({ label: 'Marketplace A' });
  await tx.getByLabel('Nome da taxa').fill('Taxa extra');
  await tx.getByLabel('Percentual (%)').fill('5');
  await tx.getByRole('button', { name: 'Cadastrar taxa' }).click();
  await expect(page.getByText(/Taxa cadastrada/).first()).toBeVisible();
  await page.goto(itemUrl);
  await expect(page.getByRole('row', { name: /Marketplace A/ }).first()).toContainText('25,00 %'); // o item reflete a taxa nova
  await page.goto(url);
  t = await text(page);
  expect(t).toContain('R$ 12,00');
  expect(t).toContain('30,00 %');
  expect(t).not.toContain('25,00 %');
  await expect(page.getByText(/Premissas congeladas: alterar taxas, custos ou políticas depois NÃO muda esta versão/).first()).toBeVisible();
  await page.goto('/cenarios');
  await expect(page.getByRole('link', { name: 'Cenário base E2E' })).toBeVisible();
});

test('lista de preços: rascunho → envio → aprovação → publicação; preço inválido é bloqueado', async () => {
  await page.goto('/listas-precos');
  await open(page, 'Criar lista de preços');
  const f = form(page, 'Criar lista de preços');
  await f.getByLabel('Nome', { exact: true }).fill('Tabela E2E');
  await f.getByLabel('Canal').selectOption({ label: 'Marketplace A' });
  await f.getByRole('button', { name: 'Criar lista de preços' }).click();
  await page.waitForURL(/\/listas-precos\/[0-9a-f-]{36}$/);
  const v = form(page, 'Criar revisão');
  await v.getByRole('button', { name: 'Criar revisão' }).click();
  await expect(page.getByText('Revisão criada em rascunho.').first()).toBeVisible();
  await page.reload();
  await page.getByLabel('Itens da lista (uma linha por item)').fill('E2E-01;25,00\nNAO-EXISTE;10,00');
  await page.getByRole('button', { name: 'Gravar itens do rascunho' }).click();
  await expect(page.getByText(/SKU «NAO-EXISTE» não cadastrado/).first()).toBeVisible();
  await page.getByLabel('Itens da lista (uma linha por item)').fill('E2E-01;25,00');
  await page.getByRole('button', { name: 'Gravar itens do rascunho' }).click();
  await expect(page.getByText(/1 item\(ns\) gravado\(s\)/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Contribuição negativa').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText(/item\(ns\) com preço inválido/).first()).toBeVisible();
  await page.getByLabel('Itens da lista (uma linha por item)').fill('E2E-01;40,00');
  await page.getByRole('button', { name: 'Gravar itens do rascunho' }).click();
  await expect(page.getByText(/1 item\(ns\) gravado\(s\)/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Dentro das regras')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Lista enviada para aprovação.').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('Lista aprovada. Falta publicar.').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Publicar lista' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Lista publicada neste sistema/).first()).toBeVisible();
  await page.reload();
  expect(await text(page)).toContain('Publicada');
});

test('importação CSV: itens com erro/repetido; preços viram propostas pendentes e NÃO publicam', async () => {
  const csv = ['sku;nome;tipo;unidade', 'IMP-01;Importado um;produto;un', 'IMP-02;Importado dois;serviço;h', 'E2E-01;Repetido;produto;un', 'IMP-03;Tipo ruim;banana;un'].join('\n');
  await page.goto('/importacoes');
  const g = page.locator('form').filter({ has: page.getByLabel('O que importar') }).first();
  await g.getByLabel(/Arquivo CSV/).setInputFiles({ name: 'itens.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByText('Mapeamento das colunas')).toBeVisible();
  await g.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await page.waitForURL(/\/importacoes\/[0-9a-f-]{36}$/);
  let t = await text(page);
  expect(t).toMatch(/Válidas\s*2/);
  expect(t).toMatch(/Repetidas \(ignoradas\)\s*1/);
  expect(t).toMatch(/Com erro\s*1/);
  await page.getByRole('button', { name: /Confirmar importação de 2 linha/ }).click();
  await expect(page.getByText(/Importação concluída: 2 linha\(s\) aplicada\(s\)/).first()).toBeVisible();
  await page.goto('/produtos?q=IMP-');
  await expect(page.getByRole('link', { name: 'IMP-01' })).toBeVisible();

  // o mesmo arquivo não entra de novo
  await page.goto('/importacoes');
  const h = page.locator('form').filter({ has: page.getByLabel('O que importar') }).first();
  await h.getByLabel(/Arquivo CSV/).setInputFiles({ name: 'itens.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByText('Mapeamento das colunas')).toBeVisible();
  await h.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await expect(page.getByText(/já foi importado/)).toBeVisible();

  // preços: viram propostas
  const prices = ['sku;canal;preco', 'E2E-01;Marketplace A;45,00', 'ZZZ;Marketplace A;10,00'].join('\n');
  await page.goto('/importacoes');
  const k = page.locator('form').filter({ has: page.getByLabel('O que importar') }).first();
  await k.getByLabel('O que importar').selectOption({ label: 'Preços (viram propostas para aprovação)' });
  await k.getByLabel(/Arquivo CSV/).setInputFiles({ name: 'precos.csv', mimeType: 'text/csv', buffer: Buffer.from(prices, 'utf8') });
  await expect(page.getByText('Mapeamento das colunas')).toBeVisible();
  await k.getByRole('button', { name: 'Gerar prévia da importação' }).click();
  await page.waitForURL(/\/importacoes\/[0-9a-f-]{36}$/);
  t = await text(page);
  expect(t).toMatch(/Válidas\s*1/);
  expect(t).toMatch(/Com erro\s*1/);
  await page.getByRole('button', { name: /Confirmar importação de 1 linha/ }).click();
  await expect(page.getByText(/Os preços viraram propostas aguardando aprovação/).first()).toBeVisible();
  await page.goto(itemUrl);
  await expect(page.getByRole('row', { name: /Marketplace A/ }).first()).toContainText('R$ 40,00'); // preço publicado não mudou
  await page.goto('/aprovacoes');
  const ap = await text(page);
  expect(ap).toContain('Importação');
  expect(ap).toContain('R$ 45,00');
});

test('exportação CSV: BOM, separador ; e neutralização de fórmula no nome do item', async () => {
  await page.goto('/produtos');
  await open(page, 'Cadastrar produto');
  const f = form(page, 'Cadastrar');
  await f.getByLabel('SKU').fill('E2E-INJ');
  await f.getByLabel('Nome', { exact: true }).fill('=HYPERLINK("http://exemplo.invalido";"clique")');
  await f.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/);
  const res = await page.request.get('/api/export/itens');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain('SKU;Nome;Tipo;Categoria;Unidade;Preço-base;Situação');
  expect(body).toContain("'=HYPERLINK");
  expect(body).not.toMatch(/;=HYPERLINK/);
  await expectNoServerError(page, 'item');
});

// ---------------------------------------------------------------------------------------------------- pessoas diferentes (dados de demonstração)
test.describe('aprovação entre pessoas (organização de demonstração)', () => {
  const sku = 'BEL-005';
  test('analista propõe; gestor rejeita sem motivo (recusado), aprova e publica; analista não consegue aprovar', async ({ browser }) => {
    const a = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' })).newPage();
    await demoLogin(a, DEMO.analyst2);
    await a.goto(`/produtos?q=${sku}`);
    await a.getByRole('link', { name: sku }).click();
    await a.getByRole('link', { name: 'Preços e histórico' }).click();
    const f = form(a, 'Propor preço (vai para aprovação)');
    await f.getByLabel('Canal').selectOption({ label: 'Loja física' });
    const before = norm(await a.locator('main').innerText());
    void before;
    await f.getByLabel('Preço proposto (R$)').fill('99,90');
    await f.getByLabel('Justificativa').fill('Ajuste após reajuste de custos do fornecedor');
    await f.getByRole('button', { name: 'Propor preço (vai para aprovação)' }).click();
    await expect(a.getByText(/Proposta enviada para aprovação/).first()).toBeVisible();
    await a.goto('/aprovacoes');
    await expect(a.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);

    const m = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' })).newPage();
    await demoLogin(m, DEMO.manager);
    await m.goto('/aprovacoes');
    const row = m.getByRole('row').filter({ hasText: sku }).filter({ hasText: 'Ajuste após reajuste de custos' }).first();
    await row.getByRole('button', { name: 'Rejeitar' }).click();
    await expect(m.getByText(/informe o motivo da rejeição/i).first()).toBeVisible();
    await m.reload();
    const row2 = m.getByRole('row').filter({ hasText: sku }).filter({ hasText: 'Ajuste após reajuste de custos' }).first();
    await row2.getByLabel(/Observação/).fill('Conferido com a política.');
    await row2.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(m.getByText('Alteração aprovada. Falta publicar.').first()).toBeVisible();
    await m.reload();
    const row3 = m.getByRole('row').filter({ hasText: sku }).filter({ hasText: 'Ajuste após reajuste de custos' }).first();
    await row3.getByRole('button', { name: 'Publicar preço' }).click();
    await row3.getByRole('button', { name: 'Confirmar' }).click();
    await expect(m.getByText(/Preço publicado neste sistema/).first()).toBeVisible();
    await m.close(); await a.close();
  });
});

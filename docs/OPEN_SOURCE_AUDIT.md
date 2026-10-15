# OPEN_SOURCE_AUDIT — Precificação Inteligente

Pesquisa de 2026-10-14 (API do GitHub via `gh`, `npm view`, leitura de árvores e arquivos). «Incorporado» = código copiado para este repositório. **Nenhum código de terceiros foi incorporado.** Os projetos de precificação foram estudados como referência de modelagem e UX, e tudo foi reimplementado em código próprio.

| Projeto | URL | Licença (confirmada) | Estrelas | Último push | Commit consultado | Papel | Decisão |
|---|---|---|---|---|---|---|---|
| PricePilot | github.com/witejackel-eng/pricepilot | **Ambígua**: o README declara «MIT» (selo e seção), mas **não há arquivo LICENSE**, `package.json` não tem campo `license` e a API do GitHub não detecta licença | ~0 | 2026-08-02 | 5713def6cd | Referência funcional/visual (dashboard, simulador, cenários); armazenamento local (Dexie/IndexedDB), Prisma/SQLite, dezenas de scripts `qa-*.sh` | **Só referência.** Sem texto de licença com aviso de copyright não há permissão clara de cópia; nada foi copiado |
| Medusa | github.com/medusajs/medusa | MIT **exceto** materiais Enterprise (`ENTERPRISE-LICENSE.md`, licença comercial proprietária); API retorna `NOASSERTION` | ~36,7 mil | 2026-10-14 | 0b97a96ea0 | Referência: Pricing Module (price sets, price lists, price rules, vigência, precedência por contexto) | **Só referência conceitual.** Nada incorporado; materiais Enterprise jamais |
| Saleor | github.com/saleor/saleor | BSD-3-Clause | ~23,4 mil | 2026-10-14 | 925b69959a | Referência: preço por canal, listas, descontos, validação | **Só referência** (GraphQL/Django fora do escopo) |
| Decimal.js | github.com/MikeMcl/decimal.js | MIT (npm 10.6.0, sem dependências) | ~7,3 mil | 2026-08-30 | b1d1e311eb | Aritmética decimal, arredondamentos | **Usar** (já em uso no Pack) |
| Dinero.js | github.com/dinerojs/dinero.js | MIT (npm `dinero.js` 2.0.2) | ~6,8 mil | 2026-10-13 | 76b969e519 | Dinheiro em unidade mínima, imutabilidade | **Não adotar** (D-P3): centavos inteiros + Decimal.js cobrem a necessidade sem segunda biblioteca de dinheiro |
| Lotus | github.com/uselotus/lotus | MIT | ~1,8 mil | 2026-10-13 | — (API de commits lenta; árvore estudada) | Conceitos: planos, versionamento, simulação de preços | **Só referência** (domínio de cobrança de SaaS) |
| PriceGenie | github.com/jedlsf/PriceGenie | **Ambígua**: README cita «ISC (LICENSE)», mas o arquivo LICENSE não existe na raiz | ~0 | 2025-06-15 | 2ba6fe630e | Referência: composição de custos, markup | **Só referência** |
| shadcn/ui | github.com/shadcn-ui/ui | MIT | ~125 mil | 2026-10-13 | — | Kit de UI | **Não adotado** (D-P1): o Core tem kit próprio (`components/ui`), igual nos demais sistemas |
| TanStack Table | github.com/TanStack/table | MIT (8.21.3, o mesmo do Pack) | ~28,5 mil | 2026-10-12 | — | Tabelas | **Usar** 8.21.3 |
| Recharts / React Hook Form / Zod / date-fns | — | MIT | — | — | — | Gráficos, formulários, validação, datas | **Usar** (mesmas versões do Pack) |
| Papa Parse / ExcelJS / SheetJS | — | MIT / MIT / Apache-2.0 | — | — | — | CSV / XLSX | **Não adotados** (D-P7): leitor CSV próprio estrito (já validado no Pack); XLSX/PDF ficam como limite documentado |

## Achados que mudam o plano
1. **O prompt trata o PricePilot como MIT**, mas o repositório não traz o arquivo de licença. Pelo princípio «preservar avisos exigidos», **não é seguro copiar código**. As funcionalidades dele (calculadora, simulador, cenários, comparação) são ideias gerais, reimplementadas.
2. **Medusa tem materiais Enterprise**; só foi lido o conceito de precedência de regras e vigência.
3. O PricePilot guarda dados no navegador (Dexie); aqui tudo é Postgres com RLS.
4. Estrelas não provam correção de cálculo: o motor é próprio, com fórmulas documentadas e testadas à mão (PRICING_ENGINE.md).

## O que foi aprendido (ideias gerais, reimplementadas)
- **Resolução por contexto e precedência** (Medusa/Saleor): regra mais específica vence; vigência por datas; conflito não resolvido é erro, nunca soma.
- **Versionamento de listas** (Medusa/Lotus): versão publicada é imutável; mudança cria nova versão.
- **Simulação com snapshot** (PricePilot/Lotus): o cenário guarda os parâmetros usados.
- **Preço para margem-alvo** (PriceGenie/PricePilot): fórmula fechada com denominador positivo; senão, inviável.

## Dependências novas sobre o Core
Todas MIT/Apache-2.0: `recharts`, `react-hook-form` + `@hookform/resolvers`, `@tanstack/react-table`, `decimal.js`, `date-fns` (mesmas versões fixadas nos outros sistemas do Pack).

## Riscos
Licença ambígua (PricePilot/PriceGenie) → mitigada por não copiar. Enterprise do Medusa → mitigada por não ler nem usar esses materiais. Dependências: auditadas com `pnpm licenses list --prod` no fechamento.

## Situação final
Verificada em 2026-10-14 com `pnpm licenses list --prod`: MIT (54), ISC (12), Apache-2.0 (2: `@swc/helpers`, `baseline-browser-mapping`), BSD-3-Clause (2: `d3-ease`, `source-map-js`), 0BSD (1), MIT AND ISC (1) e CC-BY-4.0 (1: `caniuse-lite`, dados de compatibilidade usados na compilação). Nenhuma GPL/AGPL/SSPL. Nenhum código de PricePilot, PriceGenie, Medusa, ERPNext, Odoo ou similares foi incorporado; o motor, o solver, as migrações e os testes são originais.

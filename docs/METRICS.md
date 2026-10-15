# METRICS — Indicadores, gráficos e relatórios

Dados vêm do banco (`pr_analysis_inputs` entrega custo vigente, taxas e política já resolvidos por item × canal) e são avaliados **pelo mesmo motor** no servidor (`lib/pricing/analysis-core.ts`). Valores são **gerenciais**: margem de contribuição unitária, não lucro contábil. Preço recomendado é cálculo, não receita realizada. Filtros (categoria, canal, tipo, situação) são aplicados no banco/servidor.

## Indicadores (10)
| Indicador | Definição |
|---|---|
| Itens analisados | Itens distintos com versão de custo, preço e cálculo válido no escopo (mostra também item × canal) |
| Margem média simples | Média aritmética das margens de contribuição de cada item × canal elegível. **Não é margem consolidada ponderada** |
| Abaixo da meta | Itens com margem **abaixo da mínima** da política (estado «Abaixo da meta») |
| Contribuição negativa | Itens cujo preço atual não cobre custo variável e taxas |
| Custo incompleto | Itens sem versão de custo ou com componente de valor desconhecido; não entram nas médias |
| Diferença média de preço | Média de `(preço atual − preço para a meta) ÷ preço para a meta`, só onde ambos são calculáveis (item × canal) |
| Preços alterados no período | Publicações internas (solicitações e listas) no período filtrado |
| Cenários salvos | Cenários ativos com ao menos uma versão |
| Itens por canal | Itens com preço em cada canal |
| Variação de custo | Média da variação entre as duas últimas versões de custo (itens com histórico) e quantos subiram |

Contagens de «itens» são de itens **distintos** (um item com problema em dois canais conta uma vez); o texto do cartão mostra também item × canal.

## Gráficos (10, cada um com tabela alternativa)
Margem por categoria (média simples) · Itens por faixa de margem · Preço atual × recomendado (10 maiores diferenças) · Evolução dos custos (variação mensal média entre versões) · Comparação entre canais (margem e contribuição médias) · Composição do preço (custo, taxas/tributos informados, contribuição) · Maiores distâncias da meta (p.p.) · Cenários comparativos (última versão) · Evolução dos preços publicados (por mês) · Margem por produto ou serviço (menores margens).

## Margem ponderada (só com vendas observadas)
`Σ contribuição estimada ÷ Σ receita líquida` das vendas **elegíveis** (as que têm versão de custo vigente na data). Vendas sem custo são contadas como **não elegíveis** e ficam fora da conta. Sem vendas importadas, o valor é indisponível (nunca inventado). Dados de conferência (SQL 83): P1 custo R$ 22,00, comissão 15 % — venda a: 10 un., bruto R$ 300,00, desconto R$ 30,00, taxas R$ 40,50 → líquido 270,00, contribuição 9,50; venda b: 5 un., bruto 150,00, taxas 22,50 → líquido 150,00, contribuição 17,50. **Ponderada = 27,00 ÷ 420,00 = 6,4286 %**; a média simples das margens (3,5185 % e 11,6667 %) daria 7,5926 %. Preço médio praticado = 430,00 ÷ 16 = R$ 26,88; desconto médio = 30,00 ÷ 460,00 = 6,5217 %.

## 17 relatórios (CSV `;`, BOM, fórmulas neutralizadas, exportação auditada sem valores)
Produtos e serviços · Composição de custos · Preços atuais · Preços recomendados · Margens por produto ou serviço · Margens por categoria · Comparativo por canal · Taxas e comissões · Itens abaixo da meta · Itens com contribuição negativa · Cenários · Histórico de alterações de preço · Listas de preços · Variações de custo · Alterações aprovadas · Preços próximos da margem mínima · Simulações de desconto.

## Como conferir um número
1. Abra o item → «Resumo e margens» → «Como este preço foi calculado?» (passo a passo do motor).
2. E2E `pr-demo` recalcula a margem de PAP-006 na Loja física **fora do app**, só com os dados da API, e compara com a tela.
3. Os fixtures F1–F10 de docs/PRICING_ENGINE.md são idênticos no TypeScript e no SQL.

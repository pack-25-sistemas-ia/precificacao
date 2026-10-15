---
name: analytics-dashboard
description: Use ao criar ou alterar indicadores, gráficos, filtros e relatórios do painel de precificação.
---

# Painel e relatórios

- Indicadores vêm de `pr_analysis_inputs` (banco resolve custo vigente, taxas, política) + **motor** no servidor (`analysis-core.ts`). Nunca agregue percentuais de forma inválida: **média simples** é rotulada; **margem ponderada** só com vendas observadas e elegíveis.
- Contagens de «itens» são de itens distintos; mostre também item × canal. Trate divisão por zero (markup/margem «não calculável»), estados vazios e custo incompleto (fora das médias).
- Todo gráfico (Recharts, só no navegador) tem **tabela alternativa**; valores em BRL; filtros no servidor.
- Relatórios: o mesmo conteúdo na tela e no CSV (`reports.ts`); documente fórmulas em docs/METRICS.md com dados de conferência.

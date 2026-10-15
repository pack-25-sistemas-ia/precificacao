---
name: pricing-domain
description: Use ao tocar em qualquer regra de preço, margem, markup, canal, taxa, política ou aprovação: terminologia e limites do domínio.
---

# Domínio de precificação

- **Margem de contribuição** = (preço − custos variáveis − taxas e tributos informados) ÷ preço. **Markup** = (preço − custo-base) ÷ custo-base. Nunca sinônimos; custo-base 0 → «não calculável».
- Contribuição ≠ lucro líquido; **resultado gerencial** = contribuição − rateio de estrutura. Preço recomendado ≠ receita realizada. Simulação ≠ resultado.
- Custo desconhecido **não é zero** (item incompleto). Tributos são **parâmetros informados** com origem; não calcular tributo oficial.
- Taxas: base `price`, `net_price`, `cost`, `fixed_unit`, `fixed_transaction`; mínimo/teto só em percentuais. Não somar bases diferentes como equivalentes.
- Política = dados (margem-alvo/mínima, desconto máximo, arredondamento, preço mínimo), precedência fixa item+canal → item → categoria+canal → categoria → canal → global; conflito é erro.
- Publicar é **interno**; nada vai a marketplaces. Preço importado vira proposta.
- Detalhes: docs/PRICING_ENGINE.md, COST_MODEL.md, MARGIN_RULES.md.

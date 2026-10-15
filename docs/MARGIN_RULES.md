# MARGIN_RULES — Margens, markup e metas

## Definições (nunca intercambiáveis)
- **Margem de contribuição (%)** = `(Preço − custos variáveis − taxas de venda) ÷ Preço`. Base: o **preço**.
- **Markup (%)** = `(Preço − custo-base) ÷ custo-base`. Base: o **custo** indicado (variável ou completo). Custo-base 0 → «não calculável».
- **Resultado gerencial unitário** = contribuição − rateio. Não é lucro líquido contábil.
- **Preço recomendado** é uma sugestão calculada; **não é receita realizada**. **Simulação** não é resultado financeiro.
- Conversão (só para entender): sem taxas, `margem = markup ÷ (1 + markup)`.

## Metas e limites (política)
| Campo | Significado |
|---|---|
| Margem-alvo | contribuição desejada; é a base do «preço-alvo» |
| Margem mínima | abaixo dela o item fica «abaixo da meta» e a lista de preços **não publica** |
| Desconto máximo | teto para descontos propostos (e para a aprovação) |
| Arredondamento | `nearest`, `up`, `down`, `charm_90`, `charm_99` |
| Preço mínimo autorizado | piso absoluto em centavos |
Validações: `0 ≤ mínima ≤ alvo < 100 %`; desconto máximo em `[0, 100)`.

## Classificação de risco (fórmulas transparentes, sem pontuação inventada)
Para cada item × canal, na ordem (a primeira que se aplica):
1. **Custo incompleto** — faltam componentes (D-P6).
2. **Regra inválida** — política ou taxas que tornam o cálculo inviável (denominador ≤ 0) ou não resolvível.
3. **Contribuição negativa** — contribuição unitária < 0 no preço atual.
4. **Abaixo do equilíbrio** — preço atual < preço de equilíbrio (equivale a 3 quando as hipóteses são as mesmas; mostrado quando o preço de equilíbrio é calculável).
5. **Abaixo da meta** — margem < margem mínima da política.
6. **Necessita revisão** — margem entre a mínima e a meta, ou preço sem revisão há mais de N dias (configurável, padrão 90).
7. **Dentro da meta** — margem ≥ meta.
Sem preço atual: estado «sem preço» (não entra nas médias).

## Alertas
Preço abaixo do equilíbrio; margem abaixo do mínimo; aumento de custo que derruba a margem (comparação entre as duas últimas versões de custo); taxa alterada; produto sem custo; preço não revisado há N dias; política vencida; cenário inviável. Cada alerta explica a origem (item, canal, política/escopo, versão).

## Médias
- Painel: **média simples** das margens unitárias dos itens × canais elegíveis (rotulada como tal; não é margem consolidada).
- **Margem ponderada** = `Σ contribuição ÷ Σ receita líquida` **somente** com vendas observadas importadas e período/custos consistentes (METRICS.md). Nunca se faz média de percentuais como se fosse margem consolidada.
- Canais diferentes não se misturam numa mesma média sem o filtro explícito.

## Evidências
`tests/unit/pricing-engine.test.ts` (F1–F10 e propriedades), `tests/unit/pricing-risk.test.ts`, SQL 82 (políticas, precedência, conflito), E2E.

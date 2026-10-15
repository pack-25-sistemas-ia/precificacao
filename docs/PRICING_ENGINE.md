# PRICING_ENGINE — Motor de precificação

Código: `lib/pricing/engine/` (TypeScript puro, sem React nem banco). Espelho no banco: **só a avaliação direta** (`private.pr_evaluate`), que recalcula e verifica tudo o que é gravado (D-P2). Versão do motor: `ENGINE_VERSION = '1.0.0'` (gravada em cada cenário).

## 1. Representação
- Preço, taxas fixas, custos totais e resultados finais: **centavos inteiros**. Custos unitários e taxas por unidade podem ter **fração de centavo** (Decimal, 6 casas). Percentuais entram como **percentual** (12,5 = 12,5 %) e viram fração `÷ 100` internamente.
- Intermediários em `decimal.js` (precisão 40). **Arredondamento só na fronteira de centavos**, meio-para-cima (`ROUND_HALF_UP`), uma vez por linha (cada taxa, cada total de custo).
- Nada de `number` binário em dinheiro: o motor recebe e devolve `string`/`bigint`-safe (`Cents = number` inteiro seguro) e recusa não inteiros.

## 2. Entradas de uma avaliação
`evaluate({ priceCents, quantity = 1, variableUnitCost, overheadUnit?, fees[], markupBase })`
- `variableUnitCost`: custo variável por unidade (centavos, decimal), **conhecido** — custo desconhecido nunca chega ao motor (a camada de custos devolve `incomplete`).
- `quantity` (q): unidades da transação (padrão 1). Fixos por transação são divididos por q.
- `fees[]`: linhas de taxa `{ id, name, kind, basis, ratePct?, fixedCents?, minCents?, maxCents? }`.
  - `kind`: `commission | payment | platform | shipping_subsidy | transaction | tax | other` (rótulo; `tax` vem do perfil tributário informado — não é cálculo fiscal).
  - `basis`: `price` | `net_price` | `cost` | `fixed_unit` | `fixed_transaction`.
- `markupBase`: `variable_cost` (padrão) ou `full_cost` (variável + rateio).

## 3. Avaliação direta (a verdade do cálculo)
Para a transação de q unidades, com `R = round(P × q)` receita:
1. `Custo variável da transação = round(C × q)`.
2. Taxas **sobre preço**: `round(rate × R)`; **sobre custo**: `round(rate × C × q)`; **fixo por unidade**: `round(fixed × q)`; **fixo por transação**: `fixed`. Cada taxa com `min`/`max` é limitada a essa faixa (por transação).
3. Taxas **sobre preço líquido** (`net_price`): `round(rate × (R − Σ taxas sobre preço já limitadas))`.
4. `Contribuição = R − custo variável − Σ taxas`. `Margem de contribuição = Contribuição ÷ R`. Preço ≤ 0 → «não calculável».
5. `Markup = (P − base) ÷ base`, com `base` = custo variável (ou completo). `base = 0` → «não calculável» (nunca infinito).
6. Com rateio: `Resultado gerencial = Contribuição − round(overhead × q)` (**não é lucro líquido contábil**).
7. Valores por unidade = valor da transação ÷ q (para exibição).

Cada resultado traz `steps[]` (a linha-a-linha da calculadora «Como este preço foi calculado?»: fórmula, valores, base, arredondamento).

## 4. Preço para uma margem (solver)
Objetivo: achar `P` tal que `Contribuição(P) = m × R` (m = margem-alvo de contribuição; `m = 0` é o **equilíbrio unitário**; `targetBasis: 'managerial'` inclui o rateio como custo).

**Caso simples** (todas as taxas lineares no preço, sem teto/piso): cada taxa é `a × R + b`, e
`R = (C×q + Σb) ÷ (1 − m − Σa)`.
- `Σa` soma só coeficientes de **taxas sobre preço** e a parte linear das de **preço líquido** (`rate × (1 − Σa_preço)`). Taxas sobre custo e fixas entram em `b`.
- Denominador `≤ 0` → **inviável** (`status: 'inviable'`); nenhum preço é devolvido.

**Taxas com mínimo/máximo** (linear por partes): para cada taxa limitada há 3 regimes (livre, no piso, no teto). O solver enumera as combinações (até 8 taxas limitadas = 6.561), resolve cada sistema linear e **mantém só as soluções verificadas** pela avaliação direta com `|Contribuição − m×R| ≤ 1e-6`. Várias raízes → escolhe a **menor** e avisa. Nenhuma verificada (com algum denominador positivo) → `unresolvable` («não resolvível com segurança»: pede mais parâmetros, não inventa preço). Mais de 8 taxas limitadas → `unresolvable`.

**Arredondamento do preço** (`rounding`): `nearest` (padrão), `up`, `down`, `charm_90`, `charm_99` (para cima até terminar em ,90/,99). Depois de arredondar, o motor **reavalia** o preço inteiro em centavos e informa `meetsTarget` e `achievedMargin`; se o arredondamento deixou a margem abaixo da meta, aparece o aviso «margem X abaixo da meta por arredondamento».

**Preço mínimo autorizado** (política) entra como piso: `P = max(P_calculado, piso)` e o resultado indica `floorApplied`.

## 5. Markup como estratégia
`priceFromMarkup(base, markupPct) = round(base × (1 + markupPct/100))`. Mostra sempre a **margem equivalente** (markup ≠ margem: 60 % de markup ≈ 37,5 % de margem sem taxas).

## 6. Desconto
`applyDiscount(listPrice, { percent | fixedCents })`: preço final = `list × (1 − d)` ou `list − fixo`. `d` fora de `[0, 100)`, ou desconto fixo ≥ preço → erro de validação. **As taxas são recalculadas sobre o preço final** (nunca se subtrai o desconto da margem percentual). `maxDiscount(list, minMargin)`: preço mínimo para a margem mínima (solver com `up`); desconto máximo = `floor((list − P_min) ÷ list × 100 em 0,01)`; sem folga → 0; inviável → «indisponível».

## 7. Regras comerciais (políticas)
Resolução por **especificidade** (D-P10), a primeira que existir e estiver vigente na data:
1. item + canal · 2. item · 3. categoria + canal · 4. categoria · 5. canal · 6. global.
Duas atribuições no mesmo escopo e vigências sobrepostas são **impedidas no banco** (exclusão por intervalo). A resolução devolve a política **e o escopo** que venceu, para explicar a origem.

## 8. Fixtures conferidas à mão (testes unitários e SQL)
Todas com `q = 1`. Valores em centavos.

| # | Cenário | Resultado esperado |
|---|---|---|
| F1 | C = 5000; taxa 15 % sobre preço; m = 25 %; `nearest` | P* = 8333,33… → **8333**; taxa 1250 (1249,95); contribuição 2083; margem **24,997 %** (aviso de −0,003 p.p.); com `up`: 8334, contribuição 2084, margem 25,006 % |
| F2 | C = 5000; fixo/unid. 100; taxa 15 %; m = 0 | **6000** exato; taxa 900; contribuição 0 |
| F3 | taxa 80 % + m = 25 % (ou 75 % + 25 %) | **inviável** (denominador −0,05 / 0) |
| F4 | C = 5000; plataforma 10 % sobre preço; imposto informado 8 % sobre `net_price`; m = 20 % | Σa = 0,10 + 0,08×0,90 = 0,172 → R = 5000 ÷ 0,628 = **7961,78** → 7962 |
| F5 | C = 5000; comissão 10 % com **teto 500**; m = 20 % | regime livre inválido (taxa 714 > 500); regime no teto: R = 5500 ÷ 0,8 = **6875** exato; contribuição 1375 = 20 % |
| F6 | markup 60 % sobre C = 5000, sem taxas | P = 8000; contribuição 3000; **margem 37,5 %** |
| F7 | lista 10000; C = 6000; taxa 10 %; desconto 10 % | P = 9000; taxa 900; contribuição 2100; margem 23,33 % (antes: 3000 / 30 %); diferença −900. Desconto máximo p/ margem mínima 20 %: P_min = 6000 ÷ 0,7 = 8571,43 → `up` 8572 → **14,28 %** |
| F8 | C = 0 (custo-base zero) | markup «não calculável»; margem calculável |
| F9 | q = 10; fixo por transação 500; C = 1000/un.; preço 2500 | R = 25000; custo 10000; taxa fixa 500; contribuição 14500; por unidade 1450 |
| F10 | overhead: aluguel 300000/mês ÷ volume 1500 = 200/un. | resultado gerencial = contribuição − 200 |

## 9. Propriedades testadas (além dos exemplos)
Para entradas aleatórias determinísticas (semente fixa): (a) `evaluate(solve(m))` tem margem ≥ `m − 1/R` (tolerância de 1 centavo) com `up`; (b) com `up`, `P − 1` centavo **não** atinge `m` (preço mínimo); (c) o solver nunca devolve preço quando `1 − m − Σa ≤ 0`; (d) `markup` e margem nunca se confundem; (e) resultados idênticos em duas execuções.

## 10. O que o motor NÃO faz
Não calcula tributo oficial, não escolhe regime, não presume elasticidade, não prevê volume e não promete lucro: é **margem de contribuição unitária** sob os parâmetros informados.

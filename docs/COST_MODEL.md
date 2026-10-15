# COST_MODEL — Composição de custos

## Classes de custo
| Classe | Exemplos | Entra em | Não entra em |
|---|---|---|---|
| **Direto/variável unitário** | aquisição, matéria-prima, mão de obra direta variável, embalagem, frete de aquisição, insumo, serviço terceirizado, outro custo direto | custo variável `C` → contribuição | — |
| **Venda** | comissão, taxa de cartão/plataforma, frete subsidiado, taxa por transação, tributos **informados** | taxas do canal (`fees[]`) | custo do item |
| **Estrutura rateada** | aluguel, administração, licenças, equipe fixa | resultado **gerencial** (após rateio) | contribuição e margem de contribuição |

## Componente de custo (`cost_components`)
`unit_cost = amount ÷ quantity × usage`
- `amount`: valor em **centavos** (pode ter fração; `null` = **desconhecido**).
- `quantity`: quantas unidades do item o valor cobre (lote). Compra de 100 un. por R$ 2.000,00 → `amount = 200000`, `quantity = 100` → R$ 20,00/un.
- `usage`: quanto se consome por unidade (horas, kg…). Mão de obra de R$ 80,00/h × 2,5 h → `amount = 8000`, `quantity = 1`, `usage = 2,5` → R$ 200,00.
- Mesmo exemplo do prompt: aquisição 20,00 + embalagem 2,00 = **custo direto unitário R$ 22,00**.

### Rateio de estrutura (`allocation_method`)
| Método | Fórmula do rateio por unidade | Parâmetros |
|---|---|---|
| `volume` | `amount ÷ volume previsto/mês` | `quantity` = volume previsto |
| `services` | `amount ÷ quantidade de serviços/mês` | `quantity` |
| `hours` | `amount ÷ horas produtivas/mês × horas por unidade` | `quantity` = horas/mês; `usage` = horas por unidade |
| `percent` | `percentual × custo direto unitário` | `usage` = percentual (ex.: 5 = 5 %) |
| `manual` | `amount` já é por unidade | — |
Parâmetro faltando ou ≤ 0 (divisor) → rateio **desconhecido**: o resultado gerencial fica «indisponível»; a contribuição continua calculável.

## Completude (D-P6)
- Componente ativo de custo direto com `amount = null` → **item incompleto** (`unknown_cost`).
- Item sem nenhum componente direto ativo → **incompleto** (`no_cost`).
- Item incompleto **não recebe preço sugerido**, não entra nas médias e gera alerta; a tela diz qual componente falta. **Zero só existe se a pessoa digitar zero** (e a tela pede confirmação para custo-base igual a zero).
- Limites: `amount` ≥ 0 e ≤ 10^12 centavos; `quantity` > 0; `usage` > 0.

## Versões de custo (`cost_model_versions`)
- Os componentes são o **rascunho**; «Salvar versão» grava um **snapshot imutável** (componentes, custo direto unitário, rateio unitário, custo completo, autor, data) com `version_number` sequencial por item. Gatilho recusa UPDATE/DELETE.
- O custo vigente de um item é o da **última versão**; alterar o rascunho não muda nada até salvar nova versão. Comparar versões mostra variação absoluta e percentual por componente.
- Custos históricos nunca são editados: uma correção é uma nova versão.

## Evidências
Testes unitários `tests/unit/pricing-costs.test.ts` (F9/F10 e o exemplo de 22,00), SQL 81 (versões imutáveis, numeração, completude).

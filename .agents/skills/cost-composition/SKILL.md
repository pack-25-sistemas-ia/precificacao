---
name: cost-composition
description: Use ao criar ou alterar componentes de custo, rateio de estrutura, completude de custo ou versões de custo.
---

# Composição de custos

- `unit_cost = amount ÷ quantity × usage`. `quantity` = unidades que o valor cobre (lote); `usage` = consumo por unidade (horas, kg…). Percentual de rateio vai em `usage`.
- Classes: **direto/variável** (entra na contribuição), **venda** (taxas do canal) e **estrutura rateada** (só no resultado gerencial). Métodos de rateio: volume, serviços, horas, percentual do custo direto, manual.
- **Desconhecido ≠ zero**: `amount_cents` nulo mantém o item incompleto; item sem componente direto também. Sem versão de custo: sem sugestão, sem cenário, sem lista, fora das médias.
- Componentes são **rascunho**; «Salvar versão» (`pr_save_cost_version`) grava snapshot **imutável** e numeração sequencial (trava o item). Correção = nova versão.
- Espelhos: `lib/pricing/engine/costs.ts` ↔ `private.pr_unit_costs`. Testes: `pricing-costs.test.ts`, SQL 81.

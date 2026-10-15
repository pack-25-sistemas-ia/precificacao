---
name: decimal-money-calculations
description: Use ao somar, multiplicar, dividir, arredondar, converter ou formatar dinheiro, percentuais e quantidades.
---

# Cálculos decimais

- Dinheiro final em **centavos inteiros** (`bigint`; inteiro seguro no TS); custos unitários com fração de centavo (`numeric(24,6)`); percentuais como % com 4 casas. **Nunca `number` com casas decimais em dinheiro.**
- Motor: `D` (decimal.js, precisão 40, meio-para-cima) em `lib/pricing/engine/decimal.ts`; **arredondar só na fronteira de centavos**, uma vez por linha (cada taxa, cada total de custo).
- Entrada brasileira (`parseBRL`, `parseQty`, `parseUnitCostCents`, `parsePct`): «1.234,56», vírgula decimal, até 4 casas em custos; recusa lixo e acima do teto.
- Espelho SQL: `numeric` + `round()` (meio-para-cima para positivos) em `private.pr_evaluate`; mesmos fixtures F1–F10 em `tests/unit/pricing-engine.test.ts` e `supabase/tests/80_pr_evaluate.sql`.
- Mudou fórmula ou arredondamento: atualize TS, SQL, os dois testes e docs/PRICING_ENGINE.md.

---
name: price-rules
description: Use ao criar políticas de preço, atribuições, precedência, vigência ou taxas por canal.
---

# Regras de preço

- Política = **dados** validados (nunca código/expressão do usuário): meta, mínima (≤ meta), desconto máximo, arredondamento, preço mínimo. Só **publicada** vale; publicar cria versão imutável.
- Precedência fixa: item+canal → item → categoria+canal → categoria → canal → global → padrão da empresa (`pr_settings`). Resolução: `private.pr_resolve_policy` ↔ `resolvePolicy`.
- Conflito (mesmo escopo e vigência sobreposta) é impedido por `exclude using gist`; item e categoria na mesma atribuição é inválido.
- Taxas de canal valem por data (`valid_from/until`); alterar vale para os próximos cálculos, nunca para retratos salvos.
- Testes: `pricing-policy-risk.test.ts`, SQL 81, E2E pr-flow/pr-security (13).

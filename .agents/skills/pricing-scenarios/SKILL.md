---
name: pricing-scenarios
description: Use ao criar, comparar ou alterar cenários de preço, snapshots e a verificação de sugestões.
---

# Cenários

- O cliente envia só **parâmetros** (preço, ajuste de custo %, custo extra, desconto %, quantidade, meta). Custos, taxas, política e **todos os resultados** vêm do banco (`pr_save_scenario`) e ficam em versões **imutáveis** com `engine_version`.
- Snapshot: mudar taxa/custo/política depois **não** altera versão salva; nova versão usa valores novos. Cenário arquivado não recebe versões.
- A sugestão de preço é calculada no **servidor** com o motor; o banco marca `suggestion_verified` só se atinge a meta e 2 centavos a menos não atingem.
- Item sem versão de custo não entra. Viável = dentro da política (não significa lucro).
- Docs: docs/SCENARIOS.md. Testes: SQL 82, E2E pr-flow/pr-security (9, 11).

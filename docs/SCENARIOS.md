# SCENARIOS — Cenários comparativos

Cenário = **simulação com premissas congeladas**. Não é resultado financeiro realizado nem previsão.

## O que o usuário informa
Para cada linha (item × canal): preço do cenário (em branco = preço atual), **ajuste de custo (%)**, custo extra (R$), **desconto (%)**, quantidade e, opcionalmente, margem-alvo. Exemplos: *Atual* (tudo em branco), *Conservador* (+8 % nos custos), *Meta* (margem-alvo de 35 %), *Promocional* (−10 %), *Premium* (+12 % no preço).

## O que o servidor e o banco fazem (`pr_save_scenario`)
1. **Congelam o contexto** de cada linha: custo da **última versão salva**, taxas do canal vigentes **hoje**, perfil tributário informado, política resolvida (com o escopo que venceu) e preço atual. Tudo vai para `input_snapshot_json`.
2. **Recalculam** pela avaliação direta (`pr_evaluate`): custo ajustado, preço após desconto, taxas sobre o preço final, contribuição, margem, markup e resultado gerencial. O navegador **não envia totais**; resultados forjados não têm onde ser gravados (sem privilégio de escrita nas tabelas de resultado).
3. **Sugestão de preço**: o servidor calcula com o motor (TypeScript) e o banco a **verifica**: atinge a meta? 2 centavos a menos já não atingem? Sugestão forjada alta demais fica «não verificada».
4. Gravam uma **versão imutável** (`pricing_scenario_versions`) com `engine_version` e os itens (`pricing_scenario_items`).

## Regras
- Alterar taxa, custo ou política **depois** não muda versões salvas; nova versão usa os valores novos.
- Item **sem versão de custo não entra** (custo desconhecido não é zero).
- Cenário arquivado não recebe versões; as versões continuam consultáveis.
- Nome único por empresa; no máximo 200 itens por cenário; desconto < 100 %.
- «Viável» = dentro da política (sem contribuição negativa, margem ≥ mínima, preço ≥ preço mínimo autorizado). Não significa lucro.

## Comparação
`/cenarios/comparar?ids=a,b,c` mostra lado a lado a última versão de cada cenário: preço, contribuição, margem e Δ de margem (pontos percentuais) contra o primeiro.

## Evidências
SQL 82 (recálculo, imutabilidade, sugestão forjada, limites, snapshot após mudança de taxa); E2E pr-flow (cenário base e taxa nova depois), pr-security (9, 11); CONC (6 versões simultâneas numeradas 1..7); MUT.

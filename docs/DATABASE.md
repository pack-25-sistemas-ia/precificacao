# DATABASE — Precificação Inteligente

Postgres (Supabase) com RLS em todas as tabelas. Cadastros simples (categorias, itens, canais, componentes de custo, taxas, perfis tributários, rascunho de políticas, atribuições, listas) escrevem por **RLS + privilégio por coluna**; versões, aprovação, publicação, cenários e importação **só por funções** `pr_*` (SECURITY DEFINER, `set search_path = ''`, todas iniciando por `private.pr_guard(org, nível)`: sessão + MFA + papel). O **preço atual nunca é coluna gravável**.

## Migrações (ordem)
| Arquivo | Conteúdo |
|---|---|
| `20270801000000_pr_schema.sql` | Tipos, tabelas, restrições (incl. de exclusão por intervalo), RLS e privilégios |
| `20270801000100_pr_guards.sql` | `pr_guard`, **`pr_evaluate`** (avaliação direta), `pr_unit_costs`, validação de tributos, gatilhos de integridade e imutabilidade |
| `20270801000200_pr_engine.sql` | Contexto (taxas do canal, política vigente), versões de custo, políticas, solicitações de preço (propor/aprovar/publicar/cancelar), avisos |
| `20270801000300_pr_lists.sql` | Listas de preço: rascunho → aprovação → publicação, retirada, descontinuação |
| `20270801000400_pr_scenarios_analysis.sql` | Cenários (recálculo e verificação), entradas da análise para o painel |
| `20270801000500_pr_import_sales.sql` | Importação CSV (prévia/confirmação), vendas observadas e margem ponderada, auditoria de exportação |
| `20270801000600_pr_misc.sql` | Nomes dos membros |

## Tabelas
- **Cadastro**: `product_categories`, `pricing_items` (produto ou serviço), `sales_channels`, `item_channel_prices` (preço atual por canal, só por função), `channel_fee_rules`, `tax_profiles` (tributos **informados**), `pr_settings`.
- **Custos**: `cost_components` (rascunho; `amount_cents` nulo = desconhecido; `quantity` = lote, `usage` = consumo, rateio por método) → `cost_model_versions` (snapshot **imutável**).
- **Políticas**: `pricing_policies` (rascunho) → `pricing_policy_versions` (imutável) → `pricing_rule_assignments` (escopo + vigência, **exclusão de conflito**).
- **Preços**: `price_change_requests` (estados e segregação) → `price_change_events` (histórico imutável); `price_lists` → `price_list_versions` (estado, vigência, **uma publicada por intervalo**) → `price_list_items` (faixas de quantidade sem sobreposição).
- **Cenários**: `pricing_scenarios` → `pricing_scenario_versions` (entradas e saídas congeladas) → `pricing_scenario_items`.
- **Dados reais opcionais**: `sales_observations` (imutável); `import_jobs`, `import_rows`.
- **Apoio**: `pr_notifications`, `pr_notification_prefs`, `audit_log` e, do Core, `organizations`, `organization_members`, `organization_settings`, `profiles`.

## Garantias no banco
| Garantia | Mecanismo |
|---|---|
| Cálculo verificado | `pr_evaluate` (espelho do motor) recalcula tudo que é gravado; sugestão só «verificada» se atinge a meta e é praticamente o menor preço |
| Custo desconhecido ≠ zero | `amount_cents` nulo; `pr_save_cost_version` recusa item incompleto; cenário/proposta/lista recusam item sem versão |
| Histórico imutável | gatilhos em versões de custo/política/cenário, itens de cenário e eventos de preço; versão de lista publicada só vira «aposentada»; solicitação não é editável |
| Preço só por aprovação | sem privilégio de escrita em `current_base_price_cents` e `item_channel_prices`; `pr_publish_price_change` revalida custo, taxas, política e confere o preço vigente (40001 se mudou) |
| Segregação | `pr_settings.segregation_of_duties` (padrão ligado) em aprovação de preço e de lista |
| Publicação única / concorrência | `FOR UPDATE` em solicitação, item, política, lista, cenário e job de importação; índice único de solicitação em andamento por item × canal |
| Regras sem código | políticas são colunas validadas; atribuições com `exclude using gist` (escopo + `daterange`) |
| Tributos informados | `pr_validate_tax_config`: origem obrigatória, alíquota 0–100, soma sobre o preço < 100 % |
| Isolamento | `organization_id` em tudo, RLS por membro, FKs compostas, `EXECUTE` revogado de `anon`/`public`; só FK para `organization_members` nas notificações (PGRST201) |

## Testes do banco
`pnpm test:db`: Core (10, 20, 30, 40) + `80` avaliação direta (F1–F10), `81` custos/políticas/tributos/solicitações/permissões, `82` listas/cenários/análise, `83` importação/vendas/exportação. `pnpm test:concurrency`: sessões reais simultâneas. `pnpm test:mutation`: quebra regras de propósito. `node scripts/seed-check.mjs`: aplica migrações + seed num Postgres descartável e confere os dados de demonstração.

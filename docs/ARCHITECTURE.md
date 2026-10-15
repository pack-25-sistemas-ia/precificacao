# ARCHITECTURE — Precificação Inteligente

Base: Core do Pack (Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase Auth/Postgres) sincronizado por `scripts/sync-core.mjs`. Layout na raiz, sem `src/` (D-P1).

## Camadas
| Camada | Onde | Responsabilidade |
|---|---|---|
| Presentation | `app/(app)/*`, `components/pricing/*` | Telas, formulários (Server Actions + Zod), tabelas, gráficos (Recharts, só no navegador via `dynamic ssr:false`), **simulador** (motor no navegador para a prévia) |
| Application | `lib/pricing/actions/*`, `action-kit.ts` | Server Actions: validam sessão, papel e entrada (Zod); chamam funções `pr_*`; **calculam a sugestão com o motor** para o banco verificar |
| Domain | `lib/pricing/engine/*` | **Motor puro**: decimal, avaliação, solver, desconto, markup, custos/rateio, políticas e precedência, risco. Sem React, sem banco |
| Infrastructure | `lib/pricing/{data,analysis,analysis-core,reports,csv,page}.ts`, `app/api/*`, `supabase/migrations` | Leituras Supabase, análise item × canal, relatórios e CSV, exportação |

## Onde moram as regras
- **Cálculo de preço**: motor TypeScript (única implementação do solver). O banco tem a **avaliação direta** e recalcula tudo que grava.
- **Estado e histórico**: banco (versões imutáveis, aprovação, publicação única, segregação, vigência, conflito de precedência).
- Nenhuma tela calcula margem por conta própria sem o motor; o simulador usa o **mesmo** motor.

## Fluxo de uma publicação de preço
Formulário (analista) → Server Action (Zod, papel) → RPC `pr_request_price_change` (contexto: custo da última versão, taxas do canal, política resolvida; `pr_check_price` recalcula e guarda o impacto) → gestor: `pr_review_price_change` (segregação, `FOR UPDATE`) → `pr_publish_price_change` (revalida tudo **agora**, confere preço vigente, grava preço, evento imutável, auditoria e aviso). Repetir devolve «já publicada».

## Fronteiras de segurança
RLS por `organization_id`; sem `service_role` no app; MFA exigido no banco para administrador; CSP estrita (sem estilo em linha); exportação CSV só para gestão, neutralizada e auditada; logs sem valores.

## Execução agendada
Não há agendador nem processo permanente: avisos nascem das próprias ações (propor, aprovar, publicar, aumento de custo, importação).

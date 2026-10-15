---
name: pricing-approvals
description: Use ao mexer no fluxo propor → aprovar → publicar (preços e listas), segregação, concorrência ou histórico de preços.
---

# Aprovação e publicação

- Estados da solicitação: pending → approved|rejected|cancelled; approved → published|cancelled (gatilho `request_guard`). Listas: draft → pending → approved → published → retired.
- **Segregação** (`pr_settings.segregation_of_duties`, padrão ligada): quem propôs/enviou não aprova a própria alteração. Rejeição exige motivo (≥ 5 caracteres). Publicar é de gestor+.
- `pr_publish_price_change` trava a solicitação (`FOR UPDATE`), **revalida custo, taxas e política agora**, confere que o preço vigente ainda é o da proposta (40001) e bloqueia contribuição negativa, margem < mínima e preço < mínimo autorizado.
- Publicar é **interno**: grava preço, evento imutável, auditoria e aviso; nada vai a plataformas externas.
- Uma solicitação em andamento por item × canal (índice único parcial). Preço importado entra como `pending`.
- Testes: SQL 81/82, CONC, MUT, E2E pr-flow, pr-security (2, 7–8, 10).

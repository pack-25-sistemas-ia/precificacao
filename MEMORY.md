# MEMORY — PRECIFICAÇÃO INTELIGENTE (precificacao)
Atualizado em: 2026-10-14 | Versão: 0.1.0 | Estado: VALIDADO localmente e na cópia exportada (falta a CI do hub e a publicação do repositório público)

## Missão do sistema
Preço no feeling, sem considerar custos, taxas e margem. Público: indústrias, lojas e prestadores que definem preço. Valor: cálculo transparente de preço, margem e markup com cenários comparáveis.

## Stack e caminhos-chave
Next.js 16 + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS); layout do Core na raiz, sem `src/` e sem shadcn (D-P1). Motor em `lib/pricing/engine/*` (TS puro, decimal.js); espelho SQL em `private.pr_evaluate`. Migrações `supabase/migrations/2027080100*_pr_*.sql`; testes SQL `supabase/tests/80–83`. Portas locais 585xx; E2E na porta 3123.
Comandos: pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e; `node scripts/seed-check.mjs`.

## Escopo entregue
Itens (produtos/serviços) e categorias; custos versionados e imutáveis (desconhecido ≠ zero, rateio de estrutura); canais, taxas (5 bases, mínimo/teto) e perfis tributários **informados**; políticas por precedência (item+canal → … → global) com conflito impedido no banco; simulador e desconto máximo; cenários com snapshots imutáveis e sugestão verificada pelo banco; listas de preço versionadas; solicitação → aprovação → publicação (interna, segregação de funções, preço desatualizado bloqueado); importação CSV (preços viram propostas); painel 10 KPIs + 10 gráficos; 17 relatórios; avisos; white-label; auditoria; 15 cenários de segurança.
Fora do escopo: apuração tributária oficial; integração com marketplaces; XLSX/PDF (D-P7).

## Verificado (2026-10-14, comandos executados)
- `pnpm lint`, `typecheck`, `build`: limpos. `pnpm test`: 105 testes (motor F1–F10, custos, políticas/risco, CSV/qty, Core).
- `pnpm test:db`: Core + 80–83 passam. `pnpm test:concurrency`: passa (publicação única, numeração sem buracos, sem impasse).
- `pnpm test:mutation`: 63 mutações. Rodada completa: 60 mortas; 3 sobreviveram (arredondamento de centavos, trava de publicação de lista, alvo mal definido da trava de cenário) e foram corrigidas com testes novos/alvo ajustado — as 3 foram **reexecutadas individualmente e morrem**; a rodada completa não foi repetida depois.
- E2E (banco recriado e app reiniciado antes de cada arquivo): core-flow 5, email-flows 3, security 5, pr-demo 6, pr-flow 11, pr-security 14, pr-ui 6 — todos passam. Screenshots regenerados de dados limpos.
- Licenças de produção: MIT/ISC/Apache-2.0/BSD/0BSD/CC-BY-4.0 (`caniuse-lite`); sem GPL/AGPL.

## Pendências e riscos
- **O prompt do Sistema 08 chegou truncado na seção 32 (testes, «Custos»)**; faltam o restante dos testes, critérios de aceite, fases e relatório (D-P14). Reconciliar com o Word íntegro.
- Cópia exportada: lint, tipos, 105 testes, build, DB, concorrência, seed-check e E2E (50) passaram. CI do hub (jobs `precificacao-*`) ainda não executada; repositório público ainda não publicado.
- Risco LGPD: baixo (só e-mail/nome da equipe; dados de demonstração fictícios).

## Armadilhas
Heredoc/`node -e` perdem barras e crases: use Write/Edit ou scripts em arquivo. `String.replace` com `$` corrompe SQL: use função. `Input` do Core não aceita `ref`. FK dupla para `organization_members` e `organizations` gera PGRST201. Teste de negação deve provar que a função existe (não aceitar 404). Mutação sem carga paralela. **O limitador de login do Core é em memória: reinicie o app entre arquivos E2E** (senão «Muitas tentativas»). Mutação que altera texto presente em mais de uma função precisa de `nth`. Asserts que misturam chamada de função e select no mesmo comando enxergam o snapshot antigo.

## Referências
docs/PRICING_ENGINE.md · COST_MODEL · MARGIN_RULES · PERMISSIONS · DECISIONS (D-P1..D-P19) · OPEN_SOURCE_AUDIT · PLANO_IMPLEMENTACAO · .agents/skills/*

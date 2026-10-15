# AGENTS — Precificação Inteligente

Sistema 08 do Pack 25 Sistemas IA (precificacao). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor e, para versões/aprovações/publicações, chama função `pr_*`.
- Nunca commitar segredos; o app não usa service-role; jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII nem valores em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:concurrency · pnpm test:mutation (sem outra carga) · pnpm test:e2e (Supabase local + app **recompilado**, porta 3123, um arquivo por vez) · pnpm seed:gen · node scripts/seed-check.mjs

## Regras do sistema
- **O motor é a única implementação do solver** (`lib/pricing/engine`, TypeScript puro). O banco espelha **só a avaliação direta** (`private.pr_evaluate`) e **verifica** tudo que grava (recalcula; sugestão só é «verificada» se atinge a meta e é praticamente o menor preço). Mudou fórmula: atualize TS **e** SQL e os fixtures F1–F10 dos dois lados (`tests/unit/pricing-engine.test.ts` ↔ `supabase/tests/80_pr_evaluate.sql`).
- **Dinheiro**: centavos inteiros; `decimal.js` (precisão 40); arredondamento só ao centavo, meio-para-cima. Nunca `number` com casas decimais em dinheiro. Custo unitário pode ter fração de centavo (`numeric(24,6)`).
- **Margem ≠ markup**; contribuição ≠ lucro líquido; preço recomendado ≠ receita realizada; simulação ≠ resultado. Fórmulas em docs/PRICING_ENGINE.md.
- **Custo desconhecido NÃO é zero**: `amount_cents = null` mantém o item incompleto (sem versão, sem sugestão, fora das médias). Nunca coalesce para 0.
- **Imutável**: versões de custo/política/lista/cenário e eventos de preço (gatilhos). Correção = nova versão. O preço atual não é coluna gravável: só `pr_publish_price_change`.
- **Segregação** (padrão ligada): quem propõe não aprova a própria alteração; aprovar e publicar travam a solicitação (`FOR UPDATE`).
- **Políticas são dados** (sem código de usuário); precedência fixa; conflito impedido por restrição de exclusão. Tributos são **parâmetros informados** com origem.
- Preço importado vira **proposta pendente**; custo importado grava só o rascunho.
- Funções `pr_*` são SECURITY DEFINER e começam por `private.pr_guard(org, nível)` (MFA + papel). Visões/tabelas: RLS por `organization_id`; FKs compostas `(id, organization_id)`.
- Tabela que referencia `organization_members` **não** referencia `organizations` (PGRST201 no embed do Core): por isso `created_by`/`requested_by` são uuid sem FK.
- Exportação CSV neutraliza fórmulas e é auditada (relatório e nº de linhas, nunca valores). CSP estrita: sem estilo em linha; gráficos só no navegador.
- Mudou regra crítica de banco ou do motor: rode `pnpm test:mutation` **sem outra carga na máquina** (todas devem morrer; crie mutação nova para regra nova) e `pnpm test:concurrency`.
- Cuidados: `String.replace` com `$$` corrompe SQL (use função ou Edit); heredoc/`node -e` perdem barras invertidas e crases (use Write/Edit); asserts SQL que misturam chamada de função e `select` do mesmo dado no MESMO statement veem o snapshot antigo (separe); `RAISE` com `%` precisa de `%%`; teste de negação deve provar que a função existe (não aceitar 404/PGRST202); logins repetidos nos E2E esbarram no limitador (reaproveite a sessão); não pare containers Supabase de outros projetos.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, concorrência real, mutação, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.

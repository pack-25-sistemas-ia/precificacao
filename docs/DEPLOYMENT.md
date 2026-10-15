# DEPLOYMENT — Precificação Inteligente

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local e para `pnpm test:db`), conta Supabase (região **São Paulo**) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |

O app **não usa** `service_role`. Não a coloque em variável alguma.

## Banco
1. **Local**: `supabase start` e `supabase db reset` (migrações + `seed.sql` fictício). As portas deste projeto são 585xx (`project_id = pack25-precificacao`). Em máquina com pouca memória: `supabase start -x realtime,imgproxy,studio,edge-runtime,logflare,vector,postgres-meta,supavisor`.
2. **Produção**: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` (cria usuários de demonstração e **desliga gatilhos de imutabilidade durante o seed**). A migração cria a extensão `btree_gist` (restrições de exclusão por intervalo); em Supabase ela vem no schema `extensions`.
3. **Autenticação** no painel do Supabase: confirmação de e-mail ligada, senha mínima de 12, **TOTP (MFA) habilitado** (administradores precisam da 2ª etapa), **SMTP próprio** e a URL do app em Redirect URLs.
4. **Backup e restauração**: backups diários do Supabase (e *Point-in-Time Recovery* em plano pago). Versões e eventos são só-acréscimo, o que facilita a conferência. Guarde exportações CSV mensais fora do Supabase.
5. **Reversão**: migrações só para frente; para voltar, restaure o backup anterior. Nunca apague versões ou eventos à mão (os gatilhos impedem; a correção é uma nova versão).

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`. Importações de CSV usam envios de até 12 MB no proxy e 6 MB em Server Actions (`next.config.ts`); em hospedagens com limite menor de corpo, reduza o arquivo.

**E2E**: `pnpm test:e2e` usa o Supabase local e o app **compilado** (`pnpm build && pnpm start -p 3123`). Copie as URLs/chaves de `supabase status` para `.env.e2e` (ignorado pelo git) com `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL` e `E2E_MAILPIT_URL`. Rode **um arquivo por vez** fora do CI (limitador de login) e **depois de `supabase db reset`** (`pr-security` e `pr-flow` alteram dados de demonstração).

## Dados de demonstração
Senha local única `DemoLocal#2026`, todos `@demo.exemplo`, empresa «Aurora Variedades e Serviços Ltda.» (fictícia): `dono@` (administrador), `gestor@` (gestor comercial), `analista@` e `analista2@`, `consulta@`. `pnpm seed:gen` regenera `supabase/seed.sql`; `node scripts/seed-check.mjs` valida o seed num Postgres descartável.

## Checklist de produção
- [ ] Região Brasil; backups ligados; MFA ligado; SMTP próprio; Redirect URLs.
- [ ] `seed.sql` **não** aplicado; nenhuma chave `service_role` em variável de ambiente.
- [ ] Cadastrar canais e taxas **reais da sua empresa** (os valores de demonstração não valem), perfis tributários com a **origem** informada pela sua contabilidade, e as políticas de margem.
- [ ] Importar itens e custos por CSV, **salvar a versão de custo** de cada item e só então propor preços.
- [ ] Decidir se mantém a **segregação de funções** (recomendado); se desligar, registre o motivo.
- [ ] Revisar o texto de privacidade com seu jurídico (controlador = quem implanta).

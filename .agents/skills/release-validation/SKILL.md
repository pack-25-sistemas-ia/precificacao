---
name: release-validation
description: Use antes de marcar o sistema como VALIDADO ou publicar: gates de qualidade e distribuição.
---

# Validação de entrega

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
2. `pnpm test:db`, `pnpm test:concurrency`, `pnpm test:mutation` (sem outra carga; **todas** as mutações devem morrer).
3. `supabase db reset` e `pnpm test:e2e` (um arquivo por vez, app **recompilado**): pr-demo, pr-flow, pr-security, pr-ui.
4. Licenças (`pnpm licenses list --prod`), segredos (`node scripts/check-no-secrets.mjs` no hub), sem GPL/AGPL.
5. Exportar o sistema isolado, instalar e rodar tudo na cópia. Docs e MEMORY.md só com fatos executados; o que não rodou é «NÃO EXECUTADO».

---
name: supabase-security
description: Use ao criar tabelas, funções, privilégios, políticas RLS, rotas de exportação ou testes de acesso.
---

# Segurança Supabase

- Toda tabela de negócio: `organization_id`, RLS, FKs compostas `(id, organization_id)`. Sem `service_role` no app. Funções `SECURITY DEFINER` com `set search_path = ''`, `EXECUTE` revogado de `public`/`anon`, liberado a `authenticated`, e `private.pr_guard(org, nível)` primeiro.
- Escrita direta só onde há **privilégio por coluna + RLS**; preço atual, status de solicitação, resultados de cenário e versões **não** são graváveis pelo usuário.
- MFA: administradores precisam de AAL2 no banco. Níveis: read, analyst (member+), manager, admin.
- **Teste de negação precisa provar que a função existe** (`expectDenied`: não aceitar 404/PGRST202) e ter controle positivo.
- Tabela com FK para `organization_members` não referencia `organizations` (PGRST201).
- Exportação CSV: só gestão, neutralizada, auditada. CSP estrita; sem estilo em linha.

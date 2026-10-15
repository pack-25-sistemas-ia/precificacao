# PLANO_IMPLEMENTACAO — Precificação Inteligente

Fases análogas às dos sistemas 06/07 (D-P14: o prompt colado terminou na seção 32). Regra de ouro do prompt: **motor testado antes de qualquer dashboard**.

| Fase | Entrega | Prova |
|---|---|---|
| 1 Pesquisa e plano | Auditoria de licenças, decisões D-P1..D-P14, especificação do motor, custos, margens, permissões | Documentos (este diretório) |
| 2 Base | Core sincronizado, dependências, configuração do sistema, portas 585xx | install, lint, tipos, unitários do Core |
| 3 **Motor** | `lib/pricing/engine/*`: dinheiro, custos, taxas, avaliação, solver, desconto, markup, políticas, risco; fixtures F1–F10 e propriedades | Vitest (`pricing-*.test.ts`) |
| 4 Banco | Migrações `pr_*`: schema, RLS, guardas, `pr_evaluate`, versões imutáveis, políticas com exclusão de conflito, listas, aprovações, cenários, importação, notificações, auditoria; testes SQL 80–85; concorrência; mutação | `pnpm test:db`, `test:concurrency`, `test:mutation` |
| 5 Aplicação | Ações de servidor (Zod + RPC), leituras, análise em servidor com o motor, relatórios, exportação, importação CSV | lint, tipos, build |
| 6 Interface | 18 telas: painel, itens, composição de custos, canais/taxas, políticas, listas, simulador, descontos, cenários, aprovações, relatórios, importações, notificações, configurações | build, E2E |
| 7 Testes de ponta a ponta | demo (dados fictícios), fluxo, segurança (15 cenários do §28), UI | Playwright contra Supabase local |
| 8 Mutação | Quebra de regras críticas (banco e motor); todas devem reprovar | `pnpm test:mutation` |
| 9 Fechamento | Docs finais, skills internas, CI no hub, exportação isolada, instalação e testes na cópia, publicação | CI verde |

## Ordem de implementação do motor (TDD)
1. `money` e `decimal` (arredondamento, centavos, percentuais) → 2. custos (unitário, completude, rateio) → 3. `evaluate` (F1–F10 diretos) → 4. solver sem tetos (F1–F4) → 5. solver com tetos (F5) → 6. arredondamentos e piso → 7. markup e desconto (F6–F8) → 8. políticas e risco → 9. propriedades.

## Dados de demonstração
Empresa fictícia (nome que não coincide com o do usuário), ~60 itens (produtos e serviços), 5 canais com taxas, 3 políticas, versões de custo ao longo de meses, listas de preço, cenários, solicitações em todos os estados, vendas observadas importadas e usuários locais `@demo.exemplo`.

## Pendência de fonte
Texto íntegro do prompt (seção 32 em diante: testes, critérios de aceite, fases, relatório) não recebido; reconciliar com o Word quando disponível (D-P14).

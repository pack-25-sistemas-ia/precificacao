# CHANGELOG_INTERNAL — Precificação Inteligente

Histórico de construção (não é changelog de produto). Datas de 2026-10-14.

| Fase | O que entrou | Lição |
|---|---|---|
| 1 Pesquisa e plano | Auditoria de licenças (PricePilot e PriceGenie **sem arquivo LICENSE** → só referência; Medusa com materiais Enterprise), decisões D-P1..D-P14, especificação do motor com fixtures F1–F10 conferidas à mão | O prompt colado veio truncado na seção 32 (D-P14); o README dizer «MIT» não substitui o arquivo de licença |
| 2 Base | Core sincronizado, dependências, config (585xx) | Layout do Core na raiz, sem `src/` e sem shadcn (D-P1) |
| 3 Motor (TDD) | Decimal, avaliação, solver por regimes (tetos/pisos), arredondamentos, markup, desconto, custos/rateio, políticas, risco; 300 casos de propriedade | «Para cima» não garantia a meta porque a taxa arredondada a centavos podia deixar a margem um tico abaixo: o solver passou a **subir até atingir** |
| 4 Banco | 7 migrações; `pr_evaluate` espelha o motor (mesmos F1–F10); versões imutáveis; políticas com exclusão de conflito; aprovação com segregação; listas; cenários; importação; testes SQL 80–83; concorrência | Asserts SQL que chamam a função e leem o dado no mesmo statement veem o snapshot antigo; verificar sugestão por avaliação direta evita reimplementar o solver em SQL |
| 5 Aplicação | Actions (Zod → RPC), análise item × canal, painel, 17 relatórios, exportação, importação | `blank()` precisa tratar campo ausente (`undefined`): formulários com campos condicionais mandam chave inexistente |
| 6 Interface | 18 telas, simulador em tempo real com passo a passo, construtor de cenários, wizard de CSV | O simulador usa o mesmo motor no navegador; a gravação é recalculada no servidor e no banco |
| 7 Seed e E2E | Seed pelas funções reais (histórico levado ao passado com gatilhos desligados só no seed); `pr-demo`, `pr-flow`, `pr-security` (15 cenários), `pr-ui` | `created_by` de lista não tinha privilégio de coluna: default `auth.uid()`; sugestão forjada alta demais passava na verificação → exige ser (quase) o menor preço |
| 8 Mutação | Regras de banco e do motor quebradas de propósito | Ver MEMORY.md para o resultado da rodada final |
| 9 Fechamento | Docs, skills internas, CI no hub, instalação isolada, publicação | — |

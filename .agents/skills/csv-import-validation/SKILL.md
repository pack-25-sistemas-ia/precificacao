---
name: csv-import-validation
description: Use ao criar ou alterar importações CSV, validações de linha, deduplicação ou exportação segura.
---

# Importação e exportação CSV

- Fluxo: navegador lê e normaliza (`lib/pricing/csv.ts`: BOM, separador, aspas, Windows-1252, vírgula decimal, percentual) → `pr_create_import` **valida cada linha no banco** (prévia, nada gravado) → `pr_commit_import` aplica **atomicamente**; confirmar duas vezes não duplica; o mesmo arquivo (hash) não entra de novo.
- Tipos: categorias, itens, custos (vazio = desconhecido; grava só o rascunho), **preços (viram propostas pendentes)**, taxas e vendas (só gestor+). Linhas repetidas (existentes ou no arquivo) e com erro são ignoradas e explicadas.
- Limites: 5 MB, 5.000 linhas, 60 colunas, 2.000 caracteres por célula; só CSV (XLSX/PDF descartados, D-P7).
- Exportação: `;`, BOM, neutraliza `=`, `+`, `-`, `@`, TAB, CR no início de texto (`safeCell`); só gestão; auditada (relatório e nº de linhas, nunca valores).
- Testes: `pricing-csv-schemas.test.ts`, SQL 83, E2E pr-flow, pr-security (10, 12).

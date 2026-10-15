# FEATURES — Precificação Inteligente
Status: VERIFIED (com evidência: arquivo/teste), FORA DO MVP ou LIMITE DOCUMENTADO. Nesta versão todos os fluxos abaixo estão VERIFIED.
Siglas de evidência: **UNIT** = `tests/unit/*` (`pnpm test`); **SQL** = `supabase/tests/NN_*.sql` (`pnpm test:db`); **CONC** = `scripts/test-concurrency.mjs`; **MUT** = `scripts/mutation-check.mjs`; **E2E** = `tests/e2e/*` (Playwright contra Supabase local).

| Fluxo | Status | Evidência |
|---|---|---|
| Motor: avaliação direta (taxas sobre preço, preço líquido, custo, fixas, teto/piso), margem, markup, resultado gerencial | VERIFIED | UNIT pricing-engine (F1–F10); SQL 80 (mesmos fixtures); E2E pr-demo (recálculo independente) |
| Motor: preço de equilíbrio e preço para a margem-alvo; cenário inviável sem preço; arredondamentos; piso | VERIFIED | UNIT pricing-engine (F1–F5, propriedades); MUT motor |
| Exemplo obrigatório do prompt (R$ 50,00, taxa 15 %, margem 25 % → R$ 83,33) | VERIFIED | UNIT F1; E2E pr-flow (R$ 22,00 → R$ 40,00 / R$ 36,67) |
| Markup ≠ margem; custo-base zero «não calculável» | VERIFIED | UNIT F6/F8; SQL 80; E2E pr-security (5) |
| Descontos: taxas recalculadas sobre o preço final, desconto máximo, limites | VERIFIED | UNIT F7; E2E pr-flow (simulador), pr-security (6) |
| Composição de custos: lote, consumo, rateio (volume/horas/percentual/manual), completude | VERIFIED | UNIT pricing-costs; SQL 81; E2E pr-flow |
| Custo desconhecido ≠ zero (item incompleto, sem sugestão, fora das médias) | VERIFIED | UNIT pricing-costs; SQL 81, 82, 83; MUT; E2E pr-flow, pr-security (15) |
| Versões de custo imutáveis e comparação entre versões | VERIFIED | SQL 81; CONC (numeração); MUT |
| Canais, taxas, perfis tributários informados (origem obrigatória; soma < 100 %) | VERIFIED | SQL 81; E2E pr-flow, pr-security (3–4) |
| Políticas como dados: publicar versão, precedência, vigência, conflito impedido | VERIFIED | UNIT pricing-policy-risk; SQL 81; CONC; MUT; E2E pr-flow, pr-security (13) |
| Classificação de risco e alertas (dentro da meta, abaixo, negativa, equilíbrio gerencial, incompleto, revisão) | VERIFIED | UNIT pricing-policy-risk; E2E pr-demo |
| Simulador em tempo real + passo a passo + salvar cenário + propor preço | VERIFIED | E2E pr-flow (simulador), pr-ui (celular) |
| Aprovação: propor → aprovar/rejeitar → publicar; segregação; publicação única; revalida custo/taxa/política; preço desatualizado | VERIFIED | SQL 81; CONC; MUT; E2E pr-flow, pr-security (2, 7–8) |
| Listas de preços versionadas (faixas de quantidade, vigência, aprovação, aposentadoria da anterior) | VERIFIED | SQL 82; CONC; MUT; E2E pr-flow |
| Cenários: snapshots imutáveis, recálculo no banco, sugestão verificada, comparação | VERIFIED | SQL 82; CONC; MUT; E2E pr-flow, pr-security (9, 11) |
| Importação CSV (categorias, itens, custos, preços, taxas, vendas): prévia, erros, repetidos, atomicidade | VERIFIED | SQL 83; CONC; MUT; E2E pr-flow, pr-security (10) |
| Preço importado nunca publica (vira proposta) | VERIFIED | SQL 83; E2E pr-flow, pr-security (10) |
| Vendas observadas e margem ponderada (só com dados reais; elegibilidade por custo vigente) | VERIFIED | SQL 83 (6,4286 % × média simples 7,59 %); MUT |
| Painel: 10 indicadores e 10 gráficos (com tabela acessível) | VERIFIED | E2E pr-demo; pr-ui |
| 17 relatórios e exportação CSV auditada (BOM, `;`, fórmulas neutralizadas) | VERIFIED | E2E pr-demo (17 abrem), pr-flow (CSV), pr-security (12); SQL 83 (auditoria sem valores) |
| Avisos internos (aprovação pendente, aprovado/rejeitado/publicado, aumento de custo, importação) e preferências | VERIFIED | SQL 81, 83; E2E pr-demo |
| Isolamento entre empresas (RLS A×B), MFA do proprietário | VERIFIED | SQL 10, 30, 81, 82, 83; E2E pr-security (1, 14, MFA) |
| Perfis: administrador, gestor comercial, analista, consulta | VERIFIED | SQL 81; E2E pr-demo, pr-security (2) |
| White-label, equipe e privacidade (LGPD) do Core | VERIFIED | SQL 10, 20, 40 (Core); lint/tipos/build |
| Acessibilidade estrutural, celular (sem rolagem lateral) e tema escuro | VERIFIED | E2E pr-ui |
| Seed reproduzível «Aurora Variedades e Serviços Ltda.» (55 itens, 5 canais, 5 políticas, listas, cenários, solicitações em todos os estados, 581 vendas observadas) | VERIFIED | `node scripts/seed-check.mjs`; E2E pr-demo |

## Limites documentados (não são pendência)
- **XLSX e PDF** não são lidos nem gerados (D-P7): só CSV.
- **Publicar é interno**: nenhuma integração com marketplaces ou lojas externas (D-P11).
- **Tributos** só como parâmetros informados; sem cálculo fiscal oficial (D-P12).
- Sem previsão de demanda, elasticidade nem volume projetado; o painel não inventa números sem dados.
- Margem agregada: **média simples** rotulada; **ponderada** só com vendas observadas importadas.
- Solver com até 8 taxas com mínimo/máximo por avaliação; acima disso, «não resolvível com segurança».

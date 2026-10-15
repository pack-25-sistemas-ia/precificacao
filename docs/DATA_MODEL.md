# DATA_MODEL — Precificação Inteligente

O modelo de dados completo (tabelas, garantias e migrações) está em [DATABASE.md](DATABASE.md); as fórmulas em [PRICING_ENGINE.md](PRICING_ENGINE.md); custos em [COST_MODEL.md](COST_MODEL.md).

Dados pessoais tratados: e-mail e nome das pessoas da equipe (Core). Custos, taxas, margens e preços são **dados comerciais sensíveis**: toda entidade tem `organization_id` e RLS, e nada é exposto entre empresas.

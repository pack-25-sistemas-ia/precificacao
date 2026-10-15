# PERMISSIONS — Perfis e permissões

Papéis do Core (`org_role`) → perfis do produto (D-P9). Autorização sempre no servidor **e** no banco (RLS + `private.pr_guard`, que exige sessão válida, MFA e papel); a interface só esconde, nunca protege sozinha.

| Ação | Administrador (owner/admin) | Gestor comercial (manager) | Analista (member) | Consulta (viewer) |
|---|---|---|---|---|
| Membros, papéis, white-label, configurações da empresa | sim | não | não | não |
| Perfis tributários (parâmetros informados) e fluxo de aprovação | sim | não | não | ver |
| Canais e regras de taxa | sim | sim | ver | ver |
| Políticas de preço: criar, editar, **publicar versão** | sim | sim | ver | ver |
| Atribuição de políticas (escopo/precedência) | sim | sim | não | ver |
| Categorias, produtos e serviços: criar/editar/arquivar | sim | sim | criar e editar; **não arquiva** | ver |
| Custos: editar componentes e **salvar versão** | sim | sim | sim | não |
| Simulador, descontos, cenários (criar/duplicar/salvar) | sim | sim | sim | só ver |
| Listas de preço: rascunho e revisão | sim | sim | sim | ver |
| **Enviar para aprovação** (propor alteração de preço) | sim | sim | sim | não |
| **Aprovar/rejeitar** alteração de preço | sim | sim | **não** | não |
| **Publicar** lista de preços / alteração aprovada | sim | sim | **não** | não |
| Importar CSV (produtos, custos, categorias, taxas, vendas) | sim | sim | produtos e custos (**nunca publica preço**) | não |
| Dashboards e relatórios | todos | todos | permitidos | permitidos |
| Exportar CSV (auditado) | sim | sim | não | não |
| Notificações | as suas | as suas | as suas | as suas |

## Segregação (configurável, ligada por padrão)
Quem propôs uma alteração **não a aprova** (nem publica a própria aprovação, quando a política exigir), mesmo sendo gestor. O administrador pode desligar a segregação nas configurações; a decisão fica no `audit_log`.

## Regras do banco
- `private.pr_guard(org, nível)`: `read` (qualquer membro), `analyst` (member+), `manager` (manager+), `admin` (owner/admin), todos exigindo MFA quando o Core exige.
- Tabelas de negócio: leitura por membros da empresa (RLS); **escrita só por funções `pr_*`**. Versões e eventos são imutáveis por gatilho.
- Custos e margens são visíveis a todos os membros (o banco não separa colunas por papel); o que muda por perfil é **quem altera, propõe, aprova e publica**.
- Concorrência: aprovar e publicar travam a solicitação (`FOR UPDATE`) e conferem o estado; a segunda chamada recebe «já aprovada/publicada».

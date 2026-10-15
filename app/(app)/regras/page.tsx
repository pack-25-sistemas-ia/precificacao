import type { Metadata } from 'next';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { AssignmentForm, DeleteAssignmentButton, PolicyButtons, PolicyForm } from '@/components/pricing/catalog-forms';
import { DateTimeBR, Disclosure, Section, TableShell, TD, TH } from '@/components/pricing/bits';
import { loadAssignments, loadItems, loadPolicies, loadPolicyVersions } from '@/lib/pricing/data';
import { SCOPE_LABELS, assignmentScope, type PolicyScope } from '@/lib/pricing/engine';
import { POLICY_STATUS_LABELS, ROUNDING_LABELS } from '@/lib/pricing/labels';
import { categoryLabel, categoryOpts, channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Políticas de preço' };

export default async function PoliciesPage() {
  const p = await pageCtx();
  const [refs, policies, versions, assignments, { rows: items }] = await Promise.all([loadRefs(p.ctx), loadPolicies(p.ctx), loadPolicyVersions(p.ctx), loadAssignments(p.ctx), loadItems(p.ctx, { limit: 2000, status: 'active' })]);
  const pol = new Map(policies.map((x) => [x.id, x]));
  const it = new Map(items.map((i) => [i.id, `${i.sku} — ${i.name}`]));
  const cat = new Map(refs.categories.map((c) => [c.id, categoryLabel(refs.categories, c)]));
  const ch = new Map(refs.channels.map((c) => [c.id, c.name]));
  const published = policies.filter((x) => x.status === 'published');
  const vOf = (id: string) => versions.filter((v) => v.policy_id === id);
  return (
    <>
      <PageHeader title="Políticas de preço" description="Metas e limites como DADOS validados: margem-alvo, margem mínima, desconto máximo, arredondamento e preço mínimo. Nenhuma regra executa código; a precedência é fixa e conflitos são impedidos." />
      <Alert tone="info">Precedência (a primeira vigente vence): {(['item_channel', 'item', 'category_channel', 'category', 'channel', 'global'] as PolicyScope[]).map((s, i) => `${i + 1}. ${SCOPE_LABELS[s]}`).join(' · ')}. Sem nenhuma atribuição, valem as margens padrão da empresa (Configurações). Só políticas <strong>publicadas</strong> valem.</Alert>
      {p.perms.manager ? <div className="my-6"><Disclosure summary="Criar política" tone="primary"><PolicyForm /></Disclosure></div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {policies.map((x) => (
          <Card key={x.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-lg font-semibold">{x.name}</h2><Badge tone={x.status === 'published' ? 'success' : x.status === 'draft' ? 'warning' : 'neutral'}>{POLICY_STATUS_LABELS[x.status]}</Badge></div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-muted">Margem-alvo</dt><dd>{String(x.target_margin_decimal).replace('.', ',')} %</dd></div><div><dt className="text-xs text-muted">Margem mínima</dt><dd>{String(x.minimum_margin_decimal).replace('.', ',')} %</dd></div>
              <div><dt className="text-xs text-muted">Desconto máximo</dt><dd>{x.max_discount_decimal === null ? '—' : `${String(x.max_discount_decimal).replace('.', ',')} %`}</dd></div><div><dt className="text-xs text-muted">Arredondamento</dt><dd>{ROUNDING_LABELS[x.rounding_rule as keyof typeof ROUNDING_LABELS]}</dd></div>
            </dl>
            <p className="text-xs text-muted">{vOf(x.id).length ? `Versões publicadas: ${vOf(x.id).map((v) => `v${v.version_number}`).join(', ')}.` : 'Nunca publicada: ainda não vale.'} {x.description ?? ''}</p>
            {p.perms.manager ? <PolicyButtons policy={x} canPublish /> : null}
            {p.perms.manager && x.status !== 'retired' ? <Disclosure summary="Editar rascunho"><PolicyForm policy={x} /></Disclosure> : null}
          </Card>
        ))}
      </div>

      <Section title="Atribuições" description="Onde cada política vale: empresa toda, canal, categoria ou item, com vigência opcional. Duas atribuições no mesmo escopo e período são recusadas pelo banco.">
        {p.perms.manager && published.length ? <div className="mb-4"><Disclosure summary="Atribuir política"><AssignmentForm policies={published.map((x) => ({ value: x.id, label: x.name }))} items={items.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }))} categories={categoryOpts(refs.categories)} channels={channelOpts(refs.channels)} /></Disclosure></div> : null}
        {p.perms.manager && !published.length ? <p className="mb-4 text-sm text-muted">Publique uma política para poder atribuí-la.</p> : null}
        <TableShell caption="Atribuições de políticas" empty={assignments.length === 0} emptyText="Nenhuma atribuição: valem as margens padrão da empresa.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Escopo</th><th scope="col" className={TH}>Onde</th><th scope="col" className={TH}>Política</th><th scope="col" className={TH}>Vigência</th><th scope="col" className={TH} /></tr></thead>
          <tbody>{assignments.map((a) => {
            const scope = assignmentScope({ itemId: a.item_id, categoryId: a.category_id, channelId: a.channel_id });
            return (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className={TD}>{SCOPE_LABELS[scope]}</td>
                <td className={TD}>{[a.item_id ? it.get(a.item_id) : null, a.category_id ? cat.get(a.category_id) : null, a.channel_id ? ch.get(a.channel_id) : null].filter(Boolean).join(' · ') || 'Empresa toda'}</td>
                <td className={TD}>{pol.get(a.policy_id)?.name ?? '—'}</td><td className={`${TD} text-xs`}>{a.valid_from ?? 'sempre'} → {a.valid_until ?? 'sem fim'}</td>
                <td className={TD}>{p.perms.manager ? <DeleteAssignmentButton id={a.id} /> : null}</td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>
      <Section title="Versões publicadas" description="Retratos imutáveis das regras no momento da publicação.">
        <TableShell caption="Versões de políticas" empty={versions.length === 0} emptyText="Nenhuma versão publicada.">
          <thead><tr className="border-b border-border"><th scope="col" className={TH}>Política</th><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Publicada em</th><th scope="col" className={TH}>Meta</th><th scope="col" className={TH}>Mínima</th></tr></thead>
          <tbody>{versions.map((v) => <tr key={v.id} className="border-b border-border last:border-0"><td className={TD}>{pol.get(v.policy_id)?.name}</td><td className={TD}>v{v.version_number}</td><td className={TD}><DateTimeBR value={v.published_at} tz={p.tz} /></td><td className={TD}>{String(v.rules_snapshot_json.target_margin_pct).replace('.', ',')} %</td><td className={TD}>{String(v.rules_snapshot_json.minimum_margin_pct).replace('.', ',')} %</td></tr>)}</tbody>
        </TableShell>
      </Section>
    </>
  );
}

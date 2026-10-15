import type { Metadata } from 'next';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { FeeRuleForm, FeeRuleRowForm, TaxProfileForm } from '@/components/pricing/catalog-forms';
import { Disclosure, Section, Tabs, TableShell, TD, TH, UnitMoney } from '@/components/pricing/bits';
import { ListFilters } from '@/components/pricing/filter-bar';
import { loadChannels, loadFeeRules, loadTaxProfiles } from '@/lib/pricing/data';
import { one, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { FEE_BASIS_LABELS, FEE_KIND_LABELS } from '@/lib/pricing/labels';
import { channelOpts, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Taxas e tributos' };

export default async function FeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const tab = one(sp.aba) === 'tributos' ? 'tributos' : 'taxas';
  const channelId = uuidOrNull(one(sp.canal));
  const [channels, rules, profiles] = await Promise.all([loadChannels(p.ctx), loadFeeRules(p.ctx), loadTaxProfiles(p.ctx)]);
  const ch = new Map(channels.map((c) => [c.id, c.name]));
  const shown = rules.filter((r) => !channelId || r.channel_id === channelId);
  return (
    <>
      <PageHeader title="Taxas, comissões e tributos informados" description="Valores cadastrados por você: o sistema não presume que as taxas de um marketplace ou cartão sejam iguais para todos, nem calcula tributo oficial." />
      <Tabs current={tab} items={[{ key: 'taxas', label: 'Taxas e comissões', href: '/taxas' }, { key: 'tributos', label: 'Perfis tributários (informados)', href: '/taxas?aba=tributos' }]} />

      {tab === 'taxas' ? (
        <>
          {p.perms.manager ? <div className="mb-6"><Disclosure summary="Cadastrar taxa" tone="primary"><FeeRuleForm channels={channelOpts(channels)} channelId={channelId ?? undefined} /></Disclosure></div> : null}
          <ListFilters action="/taxas" values={{ canal: channelId ?? '' }} fields={[{ name: 'canal', label: 'Canal', options: channelOpts(channels, true), all: 'Todos', width: 'w-56' }]} />
          <TableShell caption="Taxas por canal" empty={shown.length === 0} emptyText="Nenhuma taxa cadastrada neste filtro.">
            <thead><tr className="border-b border-border">{['Canal', 'Taxa', 'Tipo', 'Base', 'Percentual', 'Fixo', 'Mínimo', 'Teto', 'Vigência', 'Situação / edição'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 align-top">
                <td className={TD}>{ch.get(r.channel_id)}</td><td className={TD}>{r.name}</td><td className={TD}>{FEE_KIND_LABELS[r.fee_type as keyof typeof FEE_KIND_LABELS] ?? r.fee_type}</td><td className={TD}>{FEE_BASIS_LABELS[r.basis as keyof typeof FEE_BASIS_LABELS] ?? r.basis}</td>
                <td className={TD}>{r.rate_decimal === null ? '—' : `${String(r.rate_decimal).replace('.', ',')} %`}</td><td className={TD}><UnitMoney cents={r.fixed_amount_cents} /></td><td className={TD}><UnitMoney cents={r.minimum_amount_cents} /></td><td className={TD}><UnitMoney cents={r.maximum_amount_cents} /></td>
                <td className={`${TD} text-xs`}>{r.valid_from ?? 'sempre'} → {r.valid_until ?? 'sem fim'}</td>
                <td className={TD}>{p.perms.manager ? <FeeRuleRowForm rule={r} /> : <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge>}</td>
              </tr>
            ))}</tbody>
          </TableShell>
          <p className="mt-3 text-xs text-muted">Alterar uma taxa vale para os próximos cálculos. Cenários, versões de lista e solicitações já salvos guardam o retrato do momento e não mudam.</p>
        </>
      ) : (
        <>
          <Alert tone="warning">Os perfis abaixo são <strong>parâmetros informados por você</strong>, com a origem registrada. O sistema não escolhe regime tributário, não calcula ICMS-ST, PIS/Cofins ou outros tributos e não emite nota fiscal. Valide as alíquotas com seu contador.</Alert>
          {p.perms.admin ? <div className="my-6"><Disclosure summary="Criar perfil tributário" tone="primary"><TaxProfileForm /></Disclosure></div> : <p className="my-4 text-sm text-muted">Somente administradores alteram perfis tributários.</p>}
          {profiles.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum perfil tributário. Sem perfil, nenhum tributo entra no cálculo.</p> : null}
          {profiles.map((t) => (
            <Section key={t.id} title={t.name} description={t.description ?? undefined} actions={<Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Ativo' : 'Inativo'}</Badge>}>
              <TableShell caption={`Tributos de ${t.name}`} empty={t.configuration_json.taxes.length === 0}>
                <thead><tr className="border-b border-border"><th scope="col" className={TH}>Tributo</th><th scope="col" className={TH}>Alíquota</th><th scope="col" className={TH}>Base</th><th scope="col" className={TH}>Origem do parâmetro</th></tr></thead>
                <tbody>{t.configuration_json.taxes.map((x, i) => <tr key={i} className="border-b border-border last:border-0"><td className={TD}>{x.name}</td><td className={TD}>{String(x.rate_pct).replace('.', ',')} %</td><td className={TD}>{x.basis === 'net_price' ? 'sobre o preço líquido' : 'sobre o preço'}</td><td className={TD}>{x.source}</td></tr>)}</tbody>
              </TableShell>
              {p.perms.admin ? <div className="mt-3"><Disclosure summary="Editar perfil"><TaxProfileForm profile={t} /></Disclosure></div> : null}
            </Section>
          ))}
        </>
      )}
    </>
  );
}

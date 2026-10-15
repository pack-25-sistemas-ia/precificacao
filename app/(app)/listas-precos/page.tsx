import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DateBR, Disclosure, TableShell, TD, TH } from '@/components/pricing/bits';
import { ListForm } from '@/components/pricing/price-forms';
import { loadListVersions, loadPriceLists } from '@/lib/pricing/data';
import { LIST_STATUS_LABELS } from '@/lib/pricing/labels';
import { channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Listas de preços' };

export default async function PriceListsPage() {
  const p = await pageCtx();
  const [refs, lists, versions] = await Promise.all([loadRefs(p.ctx), loadPriceLists(p.ctx), loadListVersions(p.ctx)]);
  const ch = new Map(refs.channels.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Listas de preços" description="Preços comerciais publicados DENTRO deste sistema, em versões imutáveis: rascunho → aprovação → publicação. Publicar não envia nada a marketplaces ou lojas externas." />
      {p.perms.analyst ? <div className="mb-6"><Disclosure summary="Criar lista de preços" tone="primary"><ListForm channels={channelOpts(refs.channels)} /></Disclosure></div> : null}
      <TableShell caption="Listas de preços" empty={lists.length === 0} emptyText="Nenhuma lista. Crie a primeira e depois uma revisão com os preços.">
        <thead><tr className="border-b border-border"><th scope="col" className={TH}>Lista</th><th scope="col" className={TH}>Canal</th><th scope="col" className={TH}>Última versão</th><th scope="col" className={TH}>Vigente em</th><th scope="col" className={TH}>Situação</th></tr></thead>
        <tbody>{lists.map((l) => {
          const vs = versions.filter((v) => v.price_list_id === l.id);
          const cur = vs.find((v) => v.status === 'published');
          const last = vs[0];
          return (
            <tr key={l.id} className="border-b border-border last:border-0">
              <td className={TD}><Link className="font-medium underline underline-offset-2" href={`/listas-precos/${l.id}`}>{l.name}</Link></td><td className={TD}>{l.channel_id ? ch.get(l.channel_id) : 'Todos os canais'}</td>
              <td className={TD}>{last ? `v${last.version_number} · ${LIST_STATUS_LABELS[last.status]}` : '—'}</td>
              <td className={TD}>{cur ? <>v{cur.version_number}: <DateBR value={cur.valid_from} /> → <DateBR value={cur.valid_until} /></> : '—'}</td>
              <td className={TD}><Badge tone={l.status === 'active' ? 'success' : 'neutral'}>{l.status === 'active' ? 'Ativa' : 'Arquivada'}</Badge></td>
            </tr>
          );
        })}</tbody>
      </TableShell>
    </>
  );
}

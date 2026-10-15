import type { Metadata } from 'next';
import { Button, Field, PageHeader, Select } from '@/components/ui/primitives';
import { Tabs } from '@/components/pricing/bits';
import { Simulator, type SimContext } from '@/components/pricing/simulator';
import { loadItems, rpc } from '@/lib/pricing/data';
import type { FeeLine, RoundingRule } from '@/lib/pricing/engine';
import { one, uuidOrNull, type SearchParams } from '@/lib/pricing/filters';
import { channelOpts, loadRefs, pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Simulador' };

type Ctx = {
  cost: { direct_unit_cents: number; overhead_unit_cents: number | null } | null;
  fees: Array<{ id: string; name: string; kind: string; basis: string; rate_pct?: number | null; fixed_cents?: number | null; min_cents?: number | null; max_cents?: number | null }>;
  policy: { scope: string; rules: { target_margin_pct: number; minimum_margin_pct: number; max_discount_pct: number | null; rounding: string; min_price_cents: number | null } };
  current_price_cents: number | null;
};

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  const mode = one(sp.aba) === 'descontos' ? 'discount' : 'price';
  const itemId = uuidOrNull(one(sp.item));
  const channelId = uuidOrNull(one(sp.canal));
  const [refs, { rows: items }] = await Promise.all([loadRefs(p.ctx), loadItems(p.ctx, { status: 'active', limit: 2000 })]);
  let ctx: SimContext = {
    itemId: null, channelId: null, label: null, variableUnitCents: null, overheadUnitCents: null, fees: [],
    policy: { targetMarginPct: String(p.settings.default_target_margin_pct), minimumMarginPct: String(p.settings.default_minimum_margin_pct), maxDiscountPct: null, rounding: p.settings.default_rounding as RoundingRule, minPriceCents: null, scope: 'default' },
    currentPriceCents: null, incompleteReason: null,
  };
  if (itemId && channelId) {
    const item = items.find((i) => i.id === itemId);
    const channel = refs.channels.find((c) => c.id === channelId);
    if (item && channel) {
      const c = await rpc<Ctx>(p.ctx, 'pr_item_context', { p_org: p.org, p_item: itemId, p_channel: channelId, p_date: null });
      const fees: FeeLine[] = c.fees.map((f) => ({ id: f.id, name: f.name, kind: f.kind as FeeLine['kind'], basis: f.basis as FeeLine['basis'], ratePct: f.rate_pct ?? null, fixedCents: f.fixed_cents ?? null, minCents: f.min_cents ?? null, maxCents: f.max_cents ?? null }));
      ctx = {
        itemId, channelId, label: `${item.sku} — ${item.name} · ${channel.name}`,
        variableUnitCents: c.cost ? String(c.cost.direct_unit_cents) : null, overheadUnitCents: c.cost?.overhead_unit_cents == null ? null : String(c.cost.overhead_unit_cents), fees,
        policy: { targetMarginPct: String(c.policy.rules.target_margin_pct), minimumMarginPct: String(c.policy.rules.minimum_margin_pct), maxDiscountPct: c.policy.rules.max_discount_pct == null ? null : String(c.policy.rules.max_discount_pct), rounding: c.policy.rules.rounding as RoundingRule, minPriceCents: c.policy.rules.min_price_cents, scope: c.policy.scope },
        currentPriceCents: c.current_price_cents,
        incompleteReason: c.cost ? null : 'Este item não tem versão de custo: o custo não é tratado como zero. Salve uma versão de custo na tela do item ou informe o custo manualmente abaixo.',
      };
    }
  }
  const key = `${ctx.itemId ?? 'livre'}-${ctx.channelId ?? ''}-${mode}`;
  return (
    <>
      <PageHeader title={mode === 'discount' ? 'Simulador de descontos' : 'Simulador de preços'} description="Veja em tempo real como custos, taxas, margem-alvo e descontos mudam o preço. A prévia roda no navegador; o que for salvo ou proposto é recalculado e validado no servidor e no banco." />
      <Tabs current={mode === 'discount' ? 'descontos' : 'precos'} items={[{ key: 'precos', label: 'Preço e margem', href: `/simulador${itemId && channelId ? `?item=${itemId}&canal=${channelId}` : ''}` }, { key: 'descontos', label: 'Descontos', href: `/simulador?aba=descontos${itemId && channelId ? `&item=${itemId}&canal=${channelId}` : ''}` }]} />
      <form method="get" action="/simulador" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Escolher item e canal">
        {mode === 'discount' ? <input type="hidden" name="aba" value="descontos" /> : null}
        <Field label="Item (opcional)" name="item"><Select id="item" name="item" defaultValue={itemId ?? ''} className="w-72"><option value="">— modo livre —</option>{items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</Select></Field>
        <Field label="Canal" name="canal"><Select id="canal" name="canal" defaultValue={channelId ?? ''} className="w-56"><option value="">— escolha —</option>{channelOpts(refs.channels).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
        <Button type="submit">Carregar</Button>
      </form>
      <Simulator key={key} ctx={ctx} canPropose={p.perms.analyst} canSave={p.perms.analyst} focus={mode} />
    </>
  );
}

import 'server-only';
import type { Context } from '@/lib/auth/session';
import { PAGE_SIZE, safeSearch } from './filters';

// Leituras: sempre pelo cliente do usuário (RLS). Dinheiro em centavos (inteiros ou com fração, nunca float de «reais»); percentuais em %.

export type PrSettings = {
  timezone: string; default_target_margin_pct: number; default_minimum_margin_pct: number; default_rounding: string; price_review_days: number; near_minimum_margin_pp: number; segregation_of_duties: boolean;
};
export type CategoryRow = { id: string; parent_id: string | null; name: string; description: string | null; active: boolean };
export type ItemRow = {
  id: string; category_id: string | null; item_type: 'product' | 'service'; sku: string; name: string; description: string | null; unit: string; current_base_price_cents: number | null;
  price_reviewed_at: string | null; status: 'active' | 'inactive'; archived_at: string | null; created_at: string;
};
export type ChannelRow = { id: string; name: string; channel_type: string; description: string | null; tax_profile_id: string | null; active: boolean };
export type FeeRuleRow = {
  id: string; channel_id: string; name: string; fee_type: string; basis: string; rate_decimal: number | null; fixed_amount_cents: number | null; minimum_amount_cents: number | null; maximum_amount_cents: number | null;
  priority: number; active: boolean; valid_from: string | null; valid_until: string | null;
};
export type TaxProfileRow = { id: string; name: string; description: string | null; configuration_json: { taxes: Array<{ name: string; rate_pct: number; basis: string; source: string; valid_from?: string; valid_until?: string }> }; active: boolean };
export type ComponentRow = {
  id: string; item_id: string; cost_class: 'direct' | 'overhead'; cost_type: string; name: string; amount_cents: number | null; quantity: number; usage: number; unit: string | null; allocation_method: string | null; active: boolean;
};
export type CostVersionRow = {
  id: string; item_id: string; version_number: number; snapshot_json: unknown; direct_unit_cost_cents: number; allocated_overhead_unit_cents: number | null; full_unit_cost_cents: number | null; note: string | null; created_by: string | null; created_at: string;
};
export type PolicyRow = {
  id: string; name: string; description: string | null; target_margin_decimal: number; minimum_margin_decimal: number; max_discount_decimal: number | null; rounding_rule: string; min_price_cents: number | null; status: 'draft' | 'published' | 'retired'; created_at: string;
};
export type PolicyVersionRow = { id: string; policy_id: string; version_number: number; rules_snapshot_json: Record<string, unknown>; published_at: string; created_by: string | null };
export type AssignmentRow = { id: string; policy_id: string; category_id: string | null; channel_id: string | null; item_id: string | null; valid_from: string | null; valid_until: string | null };
export type PriceListRow = { id: string; name: string; description: string | null; channel_id: string | null; status: 'active' | 'archived'; valid_from: string | null; valid_until: string | null; created_at: string };
export type ListVersionRow = {
  id: string; price_list_id: string; version_number: number; status: string; valid_from: string | null; valid_until: string | null; note: string | null; submitted_by: string | null; reviewed_by: string | null;
  review_note: string | null; reviewed_at: string | null; published_at: string | null; created_by: string | null; created_at: string;
};
export type ListItemRow = { id: string; price_list_version_id: string; pricing_item_id: string; price_cents: number; minimum_quantity_decimal: number | null; maximum_quantity_decimal: number | null };
export type ScenarioRow = { id: string; name: string; description: string | null; status: 'active' | 'archived'; created_by: string | null; created_at: string; updated_at: string };
export type ScenarioVersionRow = { id: string; scenario_id: string; version_number: number; input_snapshot_json: { items: Array<Record<string, unknown>> }; output_snapshot_json: { items: Array<Record<string, unknown>> }; engine_version: string; created_by: string | null; created_at: string };
export type ScenarioItemRow = {
  id: string; scenario_version_id: string; pricing_item_id: string; channel_id: string; input_price_cents: number; suggested_price_cents: number | null; suggestion_verified: boolean | null;
  direct_cost_cents: number; fees_cents: number; contribution_cents: number; margin_decimal: number | null; markup_decimal: number | null; viable: boolean;
};
export type RequestRow = {
  id: string; item_id: string; channel_id: string | null; previous_price_cents: number | null; proposed_price_cents: number; justification: string; impact_json: { check?: { evaluation?: Record<string, unknown>; flags?: string[] } };
  status: string; source: string; requested_by: string; reviewed_by: string | null; review_note: string | null; requested_at: string; reviewed_at: string | null; published_at: string | null;
};
export type EventRow = { id: string; request_id: string | null; list_version_id: string | null; item_id: string; channel_id: string | null; previous_price_cents: number | null; new_price_cents: number; effective_at: string; created_by: string | null };
export type ObservationRow = { id: string; item_id: string; channel_id: string | null; quantity_decimal: number; gross_revenue_cents: number; discounts_cents: number; fees_cents: number; observed_at: string; external_reference: string | null };
export type ImportJobRow = { id: string; file_name: string; import_type: string; status: string; total_rows: number; successful_rows: number; failed_rows: number; duplicate_rows: number; created_at: string; completed_at: string | null };
export type ImportRowRow = { id: string; row_number: number; data: Record<string, unknown>; status: string; error_message: string | null };
export type NotificationRow = { id: string; type: string; title: string; body: string | null; resource_type: string | null; resource_id: string | null; read_at: string | null; created_at: string };
export type MemberName = { user_id: string; display_name: string; role: string };

const err = (e: { message: string } | null) => { if (e) throw new Error('consulta falhou'); };
const org = (ctx: Context) => ctx.membership.organization_id;

export async function rpc<T>(ctx: Context, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn} falhou`);
  return data as T;
}

export async function loadSettings(ctx: Context): Promise<PrSettings> {
  const { data, error } = await ctx.supabase.from('pr_settings')
    .select('timezone, default_target_margin_pct, default_minimum_margin_pct, default_rounding, price_review_days, near_minimum_margin_pp, segregation_of_duties').eq('organization_id', org(ctx)).maybeSingle();
  err(error);
  return (data as PrSettings | null) ?? { timezone: 'America/Sao_Paulo', default_target_margin_pct: 30, default_minimum_margin_pct: 10, default_rounding: 'nearest', price_review_days: 90, near_minimum_margin_pp: 2, segregation_of_duties: true };
}

export async function loadCategories(ctx: Context): Promise<CategoryRow[]> {
  const { data, error } = await ctx.supabase.from('product_categories').select('id, parent_id, name, description, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as CategoryRow[];
}

const ITEM_COLS = 'id, category_id, item_type, sku, name, description, unit, current_base_price_cents, price_reviewed_at, status, archived_at, created_at';
export async function loadItems(ctx: Context, opts: { q?: string; type?: 'product' | 'service' | null; category?: string | null; status?: string | null; archived?: boolean; page?: number; limit?: number; ids?: string[] } = {}): Promise<{ rows: ItemRow[]; total: number }> {
  let q = ctx.supabase.from('pricing_items').select(ITEM_COLS, { count: 'exact' }).eq('organization_id', org(ctx)).order('name');
  q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (opts.ids) q = q.in('id', opts.ids);
  if (opts.type) q = q.eq('item_type', opts.type);
  if (opts.category) q = q.eq('category_id', opts.category);
  if (opts.status === 'active' || opts.status === 'inactive') q = q.eq('status', opts.status);
  const s = safeSearch(opts.q);
  if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`);
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as ItemRow[], total: count ?? 0 };
}
export async function loadItem(ctx: Context, id: string): Promise<ItemRow | null> {
  const { data, error } = await ctx.supabase.from('pricing_items').select(ITEM_COLS).eq('organization_id', org(ctx)).eq('id', id).maybeSingle();
  err(error);
  return (data as ItemRow | null) ?? null;
}

export async function loadChannels(ctx: Context): Promise<ChannelRow[]> {
  const { data, error } = await ctx.supabase.from('sales_channels').select('id, name, channel_type, description, tax_profile_id, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as ChannelRow[];
}
export async function loadFeeRules(ctx: Context, channelId?: string): Promise<FeeRuleRow[]> {
  let q = ctx.supabase.from('channel_fee_rules').select('id, channel_id, name, fee_type, basis, rate_decimal, fixed_amount_cents, minimum_amount_cents, maximum_amount_cents, priority, active, valid_from, valid_until').eq('organization_id', org(ctx)).order('priority').order('name');
  if (channelId) q = q.eq('channel_id', channelId);
  const { data, error } = await q;
  err(error);
  return (data ?? []) as FeeRuleRow[];
}
export async function loadTaxProfiles(ctx: Context): Promise<TaxProfileRow[]> {
  const { data, error } = await ctx.supabase.from('tax_profiles').select('id, name, description, configuration_json, active').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as TaxProfileRow[];
}

export async function loadComponents(ctx: Context, itemId: string): Promise<ComponentRow[]> {
  const { data, error } = await ctx.supabase.from('cost_components').select('id, item_id, cost_class, cost_type, name, amount_cents, quantity, usage, unit, allocation_method, active').eq('organization_id', org(ctx)).eq('item_id', itemId).order('created_at');
  err(error);
  return (data ?? []) as ComponentRow[];
}
export async function loadAllComponents(ctx: Context): Promise<ComponentRow[]> {
  const { data, error } = await ctx.supabase.from('cost_components').select('id, item_id, cost_class, cost_type, name, amount_cents, quantity, usage, unit, allocation_method, active').eq('organization_id', org(ctx)).limit(20000);
  err(error);
  return (data ?? []) as ComponentRow[];
}
export async function loadCostVersions(ctx: Context, itemId?: string): Promise<CostVersionRow[]> {
  let q = ctx.supabase.from('cost_model_versions').select('id, item_id, version_number, snapshot_json, direct_unit_cost_cents, allocated_overhead_unit_cents, full_unit_cost_cents, note, created_by, created_at').eq('organization_id', org(ctx)).order('version_number', { ascending: false });
  if (itemId) q = q.eq('item_id', itemId); else q = q.limit(20000);
  const { data, error } = await q;
  err(error);
  return (data ?? []) as CostVersionRow[];
}

export async function loadPolicies(ctx: Context): Promise<PolicyRow[]> {
  const { data, error } = await ctx.supabase.from('pricing_policies').select('id, name, description, target_margin_decimal, minimum_margin_decimal, max_discount_decimal, rounding_rule, min_price_cents, status, created_at').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as PolicyRow[];
}
export async function loadPolicyVersions(ctx: Context): Promise<PolicyVersionRow[]> {
  const { data, error } = await ctx.supabase.from('pricing_policy_versions').select('id, policy_id, version_number, rules_snapshot_json, published_at, created_by').eq('organization_id', org(ctx)).order('version_number', { ascending: false });
  err(error);
  return (data ?? []) as PolicyVersionRow[];
}
export async function loadAssignments(ctx: Context): Promise<AssignmentRow[]> {
  const { data, error } = await ctx.supabase.from('pricing_rule_assignments').select('id, policy_id, category_id, channel_id, item_id, valid_from, valid_until').eq('organization_id', org(ctx)).order('created_at');
  err(error);
  return (data ?? []) as AssignmentRow[];
}

export async function loadPriceLists(ctx: Context): Promise<PriceListRow[]> {
  const { data, error } = await ctx.supabase.from('price_lists').select('id, name, description, channel_id, status, valid_from, valid_until, created_at').eq('organization_id', org(ctx)).order('name');
  err(error);
  return (data ?? []) as PriceListRow[];
}
export async function loadListVersions(ctx: Context, listId?: string): Promise<ListVersionRow[]> {
  let q = ctx.supabase.from('price_list_versions').select('id, price_list_id, version_number, status, valid_from, valid_until, note, submitted_by, reviewed_by, review_note, reviewed_at, published_at, created_by, created_at').eq('organization_id', org(ctx)).order('version_number', { ascending: false });
  if (listId) q = q.eq('price_list_id', listId);
  const { data, error } = await q;
  err(error);
  return (data ?? []) as ListVersionRow[];
}
export async function loadListItems(ctx: Context, versionId: string): Promise<ListItemRow[]> {
  const { data, error } = await ctx.supabase.from('price_list_items').select('id, price_list_version_id, pricing_item_id, price_cents, minimum_quantity_decimal, maximum_quantity_decimal').eq('organization_id', org(ctx)).eq('price_list_version_id', versionId).order('pricing_item_id');
  err(error);
  return (data ?? []) as ListItemRow[];
}

export async function loadScenarios(ctx: Context, opts: { archived?: boolean } = {}): Promise<ScenarioRow[]> {
  const { data, error } = await ctx.supabase.from('pricing_scenarios').select('id, name, description, status, created_by, created_at, updated_at').eq('organization_id', org(ctx)).eq('status', opts.archived ? 'archived' : 'active').order('updated_at', { ascending: false });
  err(error);
  return (data ?? []) as ScenarioRow[];
}
export async function loadScenario(ctx: Context, id: string): Promise<ScenarioRow | null> {
  const { data, error } = await ctx.supabase.from('pricing_scenarios').select('id, name, description, status, created_by, created_at, updated_at').eq('organization_id', org(ctx)).eq('id', id).maybeSingle();
  err(error);
  return (data as ScenarioRow | null) ?? null;
}
export async function loadScenarioVersions(ctx: Context, scenarioIds?: string[]): Promise<ScenarioVersionRow[]> {
  let q = ctx.supabase.from('pricing_scenario_versions').select('id, scenario_id, version_number, input_snapshot_json, output_snapshot_json, engine_version, created_by, created_at').eq('organization_id', org(ctx)).order('version_number', { ascending: false });
  if (scenarioIds) q = q.in('scenario_id', scenarioIds);
  const { data, error } = await q.limit(2000);
  err(error);
  return (data ?? []) as ScenarioVersionRow[];
}
export async function loadScenarioItems(ctx: Context, versionIds: string[]): Promise<ScenarioItemRow[]> {
  if (!versionIds.length) return [];
  const { data, error } = await ctx.supabase.from('pricing_scenario_items').select('id, scenario_version_id, pricing_item_id, channel_id, input_price_cents, suggested_price_cents, suggestion_verified, direct_cost_cents, fees_cents, contribution_cents, margin_decimal, markup_decimal, viable').eq('organization_id', org(ctx)).in('scenario_version_id', versionIds);
  err(error);
  return (data ?? []) as ScenarioItemRow[];
}

export async function loadRequests(ctx: Context, opts: { status?: string[]; limit?: number; itemId?: string } = {}): Promise<RequestRow[]> {
  let q = ctx.supabase.from('price_change_requests').select('id, item_id, channel_id, previous_price_cents, proposed_price_cents, justification, impact_json, status, source, requested_by, reviewed_by, review_note, requested_at, reviewed_at, published_at').eq('organization_id', org(ctx)).order('requested_at', { ascending: false });
  if (opts.status?.length) q = q.in('status', opts.status);
  if (opts.itemId) q = q.eq('item_id', opts.itemId);
  const { data, error } = await q.limit(opts.limit ?? 200);
  err(error);
  return (data ?? []) as RequestRow[];
}
export async function loadEvents(ctx: Context, opts: { itemId?: string; from?: string; to?: string; limit?: number } = {}): Promise<EventRow[]> {
  let q = ctx.supabase.from('price_change_events').select('id, request_id, list_version_id, item_id, channel_id, previous_price_cents, new_price_cents, effective_at, created_by').eq('organization_id', org(ctx)).order('effective_at', { ascending: false });
  if (opts.itemId) q = q.eq('item_id', opts.itemId);
  if (opts.from) q = q.gte('effective_at', opts.from);
  if (opts.to) q = q.lte('effective_at', opts.to);
  const { data, error } = await q.limit(opts.limit ?? 5000);
  err(error);
  return (data ?? []) as EventRow[];
}
export async function loadChannelPrices(ctx: Context, itemId?: string): Promise<Array<{ item_id: string; channel_id: string; price_cents: number; reviewed_at: string }>> {
  let q = ctx.supabase.from('item_channel_prices').select('item_id, channel_id, price_cents, reviewed_at').eq('organization_id', org(ctx));
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q.limit(20000);
  err(error);
  return (data ?? []) as Array<{ item_id: string; channel_id: string; price_cents: number; reviewed_at: string }>;
}

export async function loadImportJobs(ctx: Context): Promise<ImportJobRow[]> {
  const { data, error } = await ctx.supabase.from('import_jobs').select('id, file_name, import_type, status, total_rows, successful_rows, failed_rows, duplicate_rows, created_at, completed_at').eq('organization_id', org(ctx)).order('created_at', { ascending: false }).limit(100);
  err(error);
  return (data ?? []) as ImportJobRow[];
}
export async function loadImportJob(ctx: Context, id: string): Promise<ImportJobRow | null> {
  const { data, error } = await ctx.supabase.from('import_jobs').select('id, file_name, import_type, status, total_rows, successful_rows, failed_rows, duplicate_rows, created_at, completed_at').eq('organization_id', org(ctx)).eq('id', id).maybeSingle();
  err(error);
  return (data as ImportJobRow | null) ?? null;
}
export async function loadImportRows(ctx: Context, jobId: string, opts: { status?: string; page?: number; limit?: number } = {}): Promise<{ rows: ImportRowRow[]; total: number }> {
  let q = ctx.supabase.from('import_rows').select('id, row_number, data, status, error_message', { count: 'exact' }).eq('organization_id', org(ctx)).eq('import_job_id', jobId).order('row_number');
  if (opts.status) q = q.eq('status', opts.status);
  const limit = opts.limit ?? 50;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  err(error);
  return { rows: (data ?? []) as ImportRowRow[], total: count ?? 0 };
}

export async function loadObservations(ctx: Context, opts: { from: string; to: string; limit?: number }): Promise<ObservationRow[]> {
  const { data, error } = await ctx.supabase.from('sales_observations').select('id, item_id, channel_id, quantity_decimal, gross_revenue_cents, discounts_cents, fees_cents, observed_at, external_reference').eq('organization_id', org(ctx)).gte('observed_at', opts.from).lte('observed_at', opts.to).order('observed_at', { ascending: false }).limit(opts.limit ?? 5000);
  err(error);
  return (data ?? []) as ObservationRow[];
}

export async function loadNotifications(ctx: Context, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
  let q = ctx.supabase.from('pr_notifications').select('id, type, title, body, resource_type, resource_id, read_at, created_at').eq('organization_id', org(ctx)).eq('user_id', ctx.user.id).order('created_at', { ascending: false });
  if (opts.unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q.limit(opts.limit ?? 100);
  err(error);
  return (data ?? []) as NotificationRow[];
}
export async function countUnread(ctx: Context): Promise<number> {
  const { count, error } = await ctx.supabase.from('pr_notifications').select('id', { count: 'exact', head: true }).eq('organization_id', org(ctx)).eq('user_id', ctx.user.id).is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}
export async function loadNotificationPrefs(ctx: Context): Promise<Array<{ type: string; enabled: boolean }>> {
  const { data, error } = await ctx.supabase.from('pr_notification_prefs').select('type, enabled').eq('organization_id', org(ctx)).eq('user_id', ctx.user.id);
  err(error);
  return (data ?? []) as Array<{ type: string; enabled: boolean }>;
}
export async function loadMemberNames(ctx: Context): Promise<MemberName[]> {
  const { data, error } = await ctx.supabase.rpc('pr_member_names', { p_org: org(ctx) });
  if (error) return [];
  return (data ?? []) as MemberName[];
}

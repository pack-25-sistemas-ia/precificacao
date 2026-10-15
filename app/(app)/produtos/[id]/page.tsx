import type { Metadata } from 'next';
import { ItemDetail } from '@/components/pricing/pages/item-detail';
import type { SearchParams } from '@/lib/pricing/filters';

export const metadata: Metadata = { title: 'Item' };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  return <ItemDetail id={id} type="product" sp={await searchParams} />;
}

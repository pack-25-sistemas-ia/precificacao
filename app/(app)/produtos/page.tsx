import type { Metadata } from 'next';
import { ItemsList } from '@/components/pricing/pages/items-list';
import type { SearchParams } from '@/lib/pricing/filters';

export const metadata: Metadata = { title: 'Produtos' };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ItemsList type="product" sp={await searchParams} />;
}

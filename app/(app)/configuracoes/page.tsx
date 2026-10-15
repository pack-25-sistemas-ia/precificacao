import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { SettingsForm } from '@/components/pricing/catalog-forms';
import { Section } from '@/components/pricing/bits';
import { pageCtx } from '@/lib/pricing/page';

export const metadata: Metadata = { title: 'Config. de preços' };

export default async function SettingsPricingPage() {
  const p = await pageCtx();
  return (
    <>
      <PageHeader title="Configurações de preços" description="Padrões comerciais da empresa. Identidade visual (nome, logotipo, cores), equipe e privacidade ficam em Configurações, Equipe e Privacidade." />
      <Section title="Regras fixas do sistema">
        <Card className="space-y-2 p-4 text-sm">
          <p><strong>Cálculo:</strong> margem de contribuição = (preço − custos variáveis − taxas e tributos informados) ÷ preço. Markup é outra coisa: (preço − custo-base) ÷ custo-base.</p>
          <p><strong>Dinheiro:</strong> centavos inteiros e aritmética decimal; arredondamento só ao centavo, meio-para-cima. Custo desconhecido nunca vira zero.</p>
          <p><strong>Histórico:</strong> versões de custo, de política, de lista e de cenário são imutáveis; mudar uma taxa depois não altera retratos salvos.</p>
          <p><strong>Tributos:</strong> apenas parâmetros informados por você (com origem). O sistema não calcula tributo oficial nem emite documento fiscal.</p>
        </Card>
      </Section>
      <Section title="Padrões da empresa" description="Valem quando nenhuma política publicada se aplica ao item e ao canal.">
        {p.perms.admin ? <Card className="p-4"><SettingsForm settings={p.settings} /></Card> : (
          <Card className="p-4 text-sm">
            <p>Margem-alvo padrão <strong>{String(p.settings.default_target_margin_pct).replace('.', ',')} %</strong>, mínima <strong>{String(p.settings.default_minimum_margin_pct).replace('.', ',')} %</strong>; revisão de preços a cada <strong>{p.settings.price_review_days}</strong> dias; segregação de funções {p.settings.segregation_of_duties ? 'ligada' : 'desligada'}.</p>
            <p className="mt-2 text-muted">Somente administradores alteram estes parâmetros.</p>
          </Card>
        )}
      </Section>
      <Section title="Mais">
        <Alert tone="info">Canais em <Link className="underline" href="/canais">Canais</Link>; taxas e perfis tributários em <Link className="underline" href="/taxas">Taxas e tributos</Link>; metas por escopo em <Link className="underline" href="/regras">Políticas de preço</Link>; categorias são criadas nos formulários de itens e por importação.</Alert>
      </Section>
    </>
  );
}

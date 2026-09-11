'use client';

import dynamic from 'next/dynamic';

/**
 * Os cinco gráficos do dashboard, carregados **depois** que a tela já está de
 * pé. Todos vivem só aqui (nenhuma outra rota os importa), então tirá-los do
 * bundle inicial não custa nada às demais.
 *
 * Medido: o dashboard entregava 1268 KB de JS contra 680 KB do `/servidores`,
 * e a diferença era quase toda recharts. Esse peso não atrasa só o download —
 * ele precisa ser parseado e hidratado antes de a página responder ao toque, e
 * num celular a CPU é várias vezes mais lenta que a de um desktop. Com
 * `ssr: false` o recharts sai do caminho crítico: a tela pinta, hidrata e fica
 * clicável primeiro; os gráficos entram na sequência.
 *
 * O reservado é `aspect-video`, o mesmo do `ChartContainer`, então o desenho
 * ocupa exatamente o buraco que já estava lá e nada pula de lugar quando
 * chega. Sem animação de entrada de propósito.
 */
function Reservado() {
  return <div className="aspect-video w-full" aria-hidden />;
}

export const MembersGrowth = dynamic(
  () => import('./members-growth').then((m) => m.MembersGrowth),
  { ssr: false, loading: Reservado },
);

export const MessagesPerDay = dynamic(
  () => import('./messages-per-day').then((m) => m.MessagesPerDay),
  { ssr: false, loading: Reservado },
);

export const CasesByType = dynamic(
  () => import('./cases-by-type').then((m) => m.CasesByType),
  { ssr: false, loading: Reservado },
);

export const AutomodByRule = dynamic(
  () => import('./automod-by-rule').then((m) => m.AutomodByRule),
  { ssr: false, loading: Reservado },
);

export const TopChannels = dynamic(
  () => import('./top-channels').then((m) => m.TopChannels),
  { ssr: false, loading: Reservado },
);

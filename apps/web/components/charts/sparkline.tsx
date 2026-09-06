'use client';

import { Line, LineChart, ResponsiveContainer } from 'recharts';

/**
 * §6.7 — uma linha `accent` de 40px, sem eixo, sem grid e sem tooltip. É
 * enfeite informativo do stat tile: a forma importa, o valor está ao lado.
 */
export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;

  const data = values.map((value, index) => ({ index, value }));

  return (
    <ResponsiveContainer width="100%" height={40} initialDimension={{ width: 160, height: 40 }}>
      <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Line
          dataKey="value"
          type="linear"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

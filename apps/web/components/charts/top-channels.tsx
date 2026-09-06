'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

import { AXIS_PROPS, BAR_PROPS, GRID_PROPS } from './chart-theme';

export interface NamedCount {
  id: string;
  name: string;
  count: number;
}

const config = { count: { label: 'MENSAGENS', color: 'var(--accent)' } } satisfies ChartConfig;

/** Top 10 canais em barras horizontais, série única em `accent`. */
export function TopChannels({ data }: { data: NamedCount[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 0, left: 4 }}
        barCategoryGap="20%"
      >
        {/* Deitado, o grid útil é o vertical: ele acompanha o eixo de valor. */}
        <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
        <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...AXIS_PROPS} width={132} interval={0} />
        <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
        <Bar
          dataKey="count"
          fill="var(--accent)"
          radius={BAR_PROPS.radius}
          animationDuration={BAR_PROPS.animationDuration}
        />
      </BarChart>
    </ChartContainer>
  );
}

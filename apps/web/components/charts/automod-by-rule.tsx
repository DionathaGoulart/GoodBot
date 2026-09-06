'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

import { AXIS_PROPS, BAR_PROPS, GRID_PROPS } from './chart-theme';

import type { NamedCount } from './top-channels';

const config = { count: { label: 'BLOQUEIOS', color: 'var(--accent)' } } satisfies ChartConfig;

/** Hits de automod por regra no período; série única, barras retas. */
export function AutomodByRule({ data }: { data: NamedCount[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart
        data={data}
        margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
        barCategoryGap="20%"
      >
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="name" {...AXIS_PROPS} interval={0} height={40} />
        <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
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

'use client';

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatDayLabel } from '@/lib/stats-period';

import { AXIS_PROPS, GRID_PROPS, LINE_PROPS } from './chart-theme';
import { useSeriesToggle } from './series-legend';

export interface MembersPoint {
  date: string;
  joins: number;
  leaves: number;
  total: number | null;
}

const config = {
  total: { label: 'TOTAL', color: 'var(--accent)' },
  joins: { label: 'ENTRADAS', color: 'var(--success)' },
  leaves: { label: 'SAÍDAS', color: 'var(--error)' },
} satisfies ChartConfig;

const SERIES = [
  { key: 'total', label: 'TOTAL', color: 'var(--accent)' },
  { key: 'joins', label: 'ENTRADAS', color: 'var(--success)' },
  { key: 'leaves', label: 'SAÍDAS', color: 'var(--error)' },
];

/**
 * Área do total (fill `accent` a 15%, sem gradiente) com entradas e saídas por
 * cima. `connectNulls` porque o total é um nível: dia sem snapshot não é zero.
 */
export function MembersGrowth({ data }: { data: MembersPoint[] }) {
  const { isHidden, legend } = useSeriesToggle(SERIES);

  return (
    <div className="flex flex-col gap-4">
      {legend}
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayLabel} minTickGap={24} />
          <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={(value) => formatDayLabel(String(value))} />
            }
          />
          {!isHidden('total') ? (
            <Area
              dataKey="total"
              type="linear"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="var(--accent)"
              fillOpacity={0.15}
              dot={false}
              connectNulls
              animationDuration={LINE_PROPS.animationDuration}
            />
          ) : null}
          {!isHidden('joins') ? (
            <Line dataKey="joins" stroke="var(--success)" {...LINE_PROPS} />
          ) : null}
          {!isHidden('leaves') ? (
            <Line dataKey="leaves" stroke="var(--error)" {...LINE_PROPS} />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

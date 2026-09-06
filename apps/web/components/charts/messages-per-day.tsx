'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatDayLabel } from '@/lib/stats-period';

import { AXIS_PROPS, COMPARISON_COLOR, GRID_PROPS, LINE_PROPS } from './chart-theme';
import { useSeriesToggle } from './series-legend';

export interface ComparedPoint {
  date: string;
  current: number;
  previous: number;
}

const config = {
  current: { label: 'PERÍODO', color: 'var(--accent)' },
  previous: { label: 'ANTERIOR', color: COMPARISON_COLOR },
} satisfies ChartConfig;

const SERIES = [
  { key: 'current', label: 'PERÍODO', color: 'var(--accent)' },
  { key: 'previous', label: 'ANTERIOR', color: COMPARISON_COLOR },
];

/** §6.7 — atual em `accent` sólido, anterior em `base-content` a 30%. */
export function MessagesPerDay({ data }: { data: ComparedPoint[] }) {
  const { isHidden, legend } = useSeriesToggle(SERIES);

  return (
    <div className="flex flex-col gap-4">
      {legend}
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayLabel} minTickGap={24} />
          <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={(value) => formatDayLabel(String(value))} />
            }
          />
          {!isHidden('previous') ? (
            <Line dataKey="previous" stroke={COMPARISON_COLOR} {...LINE_PROPS} />
          ) : null}
          {!isHidden('current') ? (
            <Line dataKey="current" stroke="var(--accent)" {...LINE_PROPS} />
          ) : null}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

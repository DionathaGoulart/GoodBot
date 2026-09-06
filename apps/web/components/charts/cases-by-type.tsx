'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatDayLabel } from '@/lib/stats-period';

import { AXIS_PROPS, BAR_PROPS, GRID_PROPS, seriesColor } from './chart-theme';
import { useSeriesToggle } from './series-legend';

export interface StackedSeries {
  keys: string[];
  rows: Record<string, number | string>[];
}

/** Rótulo curto de cada tipo de caso (PRD §5.1). */
const CASE_LABELS: Record<string, string> = {
  ban: 'BAN',
  unban: 'UNBAN',
  softban: 'SOFTBAN',
  kick: 'KICK',
  timeout: 'TIMEOUT',
  untimeout: 'UNTIMEOUT',
  warn: 'WARN',
  note: 'NOTA',
};

function label(key: string): string {
  return CASE_LABELS[key] ?? key.toUpperCase();
}

/** Barras empilhadas: um bloco por tipo de caso, por dia. */
export function CasesByType({ data }: { data: StackedSeries }) {
  const series = data.keys.map((key, index) => ({
    key,
    label: label(key),
    color: seriesColor(index),
  }));
  const { isHidden, legend } = useSeriesToggle(series);

  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig;

  return (
    <div className="flex flex-col gap-4">
      {legend}
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <BarChart data={data.rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayLabel} minTickGap={24} />
          <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={(value) => formatDayLabel(String(value))} />
            }
          />
          {series
            .filter((item) => !isHidden(item.key))
            .map((item) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                stackId="cases"
                fill={item.color}
                radius={BAR_PROPS.radius}
                animationDuration={BAR_PROPS.animationDuration}
              />
            ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}

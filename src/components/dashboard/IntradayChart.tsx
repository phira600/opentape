import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface IntradayDataPoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IntradayChartProps {
  data: IntradayDataPoint[];
  isin?: string;
  currency?: string;
  last?: number | null;
  lastTimestamp?: string | null;
}

export function IntradayChart({ data, isin, currency, last, lastTimestamp }: IntradayChartProps) {
  const chartData = useMemo(() => {
    return data.map((point) => ({
      ...point,
      time: format(new Date(point.timestamp), "HH:mm"),
      fullTime: format(new Date(point.timestamp), "HH:mm:ss"),
    }));
  }, [data]);

  const priceRange = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 100 };
    const prices = data.flatMap((d) => [d.high, d.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding };
  }, [data]);

  const maxVolume = useMemo(() => {
    if (data.length === 0) return 1000;
    return Math.max(...data.map((d) => d.volume));
  }, [data]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Intraday Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            No data available. Run a query to see the chart.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            Intraday Chart {isin && `- ${isin}`} {currency && `(${currency})`}
          </CardTitle>
          {last !== null && last !== undefined && (
            <div className="text-right">
              <div className="text-2xl font-bold">{last.toFixed(4)}</div>
              {lastTimestamp && (
                <div className="text-xs text-muted-foreground">
                  {format(new Date(lastTimestamp), "HH:mm:ss")}
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                className="text-muted-foreground"
              />
              <YAxis
                yAxisId="price"
                domain={[priceRange.min, priceRange.max]}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => value.toFixed(2)}
                className="text-muted-foreground"
                width={60}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                domain={[0, maxVolume * 4]}
                tick={false}
                tickLine={false}
                axisLine={false}
                width={10}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background p-3 shadow-md">
                        <div className="text-xs text-muted-foreground mb-2">{d.fullTime}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <span className="text-muted-foreground">Open:</span>
                          <span className="font-medium">{d.open?.toFixed(4)}</span>
                          <span className="text-muted-foreground">High:</span>
                          <span className="font-medium text-green-500">{d.high?.toFixed(4)}</span>
                          <span className="text-muted-foreground">Low:</span>
                          <span className="font-medium text-red-500">{d.low?.toFixed(4)}</span>
                          <span className="text-muted-foreground">Close:</span>
                          <span className="font-medium">{d.close?.toFixed(4)}</span>
                          <span className="text-muted-foreground">Volume:</span>
                          <span className="font-medium">{d.volume?.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar
                yAxisId="volume"
                dataKey="volume"
                fill="hsl(var(--muted-foreground))"
                opacity={0.2}
                radius={[2, 2, 0, 0]}
              />
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#priceGradient)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

interface ChartDataPoint {
  bucket: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LatestPrice {
  trade_symbol: string;
  trade_venue: string;
  trade_price: number;
  trade_timestamp: string;
}

export function PriceChart() {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchSymbols = async () => {
    const { data, error } = await supabase.rpc("get_latest_prices");
    
    if (!error && data) {
      const prices = data as LatestPrice[];
      const uniqueSymbols = [...new Set(prices.map((p) => p.trade_symbol))];
      setSymbols(uniqueSymbols);
      if (uniqueSymbols.length > 0 && !selectedSymbol) {
        setSelectedSymbol(uniqueSymbols[0]);
      }
    }
    setIsLoading(false);
  };

  const fetchChartData = async () => {
    if (!selectedSymbol) return;

    setIsLoading(true);
    const { data, error } = await supabase.rpc("get_chart_data", {
      p_symbol: selectedSymbol,
    });

    if (!error && data) {
      setChartData(data as ChartDataPoint[]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSymbols();
  }, []);

  useEffect(() => {
    if (selectedSymbol) {
      fetchChartData();
    }
  }, [selectedSymbol]);

  const formatXAxis = (value: string) => {
    try {
      return format(new Date(value), "HH:mm");
    } catch {
      return value;
    }
  };

  const formatTooltipValue = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <CardTitle>Price Chart</CardTitle>
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Select symbol" />
            </SelectTrigger>
            <SelectContent>
              {symbols.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No chart data available. Run a fetch to populate data.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatXAxis}
                className="text-xs"
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={formatTooltipValue}
                className="text-xs"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                labelFormatter={(label) => {
                  try {
                    return format(new Date(label), "MMM d, HH:mm");
                  } catch {
                    return label;
                  }
                }}
                formatter={(value: number) => [formatTooltipValue(value), "Price"]}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

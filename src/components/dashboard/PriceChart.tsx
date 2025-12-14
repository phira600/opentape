import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, Search, CalendarIcon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";

interface ChartDataPoint {
  bucket: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SymbolResult {
  symbol: string;
  name: string | null;
}

export function PriceChart() {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Search symbols in backend
  const searchSymbols = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const { data } = await supabase
      .from("symbology")
      .select("symbol, name")
      .or(`symbol.ilike.%${query}%,name.ilike.%${query}%`)
      .limit(15);

    if (data) {
      const unique = Array.from(new Map(data.map((d) => [d.symbol, d])).values());
      setSearchResults(unique);
    }
    setIsSearching(false);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchSymbols(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, searchSymbols]);

  const fetchChartData = useCallback(async () => {
    if (!selectedSymbol) return;
    setIsLoading(true);
    const { data, error } = await supabase.rpc("get_chart_data", {
      p_symbol: selectedSymbol,
      p_start_time: dateRange.from.toISOString(),
      p_end_time: dateRange.to.toISOString(),
    });
    if (!error && data) {
      setChartData(data as ChartDataPoint[]);
    }
    setIsLoading(false);
  }, [selectedSymbol, dateRange]);

  useEffect(() => {
    if (selectedSymbol) {
      fetchChartData();
    }
  }, [selectedSymbol, fetchChartData]);

  const formatXAxis = (value: string) => {
    try {
      return format(new Date(value), "MMM d HH:mm");
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

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    setSearchQuery(symbol);
    setShowDropdown(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <CardTitle>Price Chart</CardTitle>
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Symbol Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                className="pl-9"
              />
              {showDropdown && (searchResults.length > 0 || isSearching) && (
                <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {isSearching ? (
                    <div className="p-3 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    searchResults.map((r) => (
                      <button
                        key={r.symbol}
                        onClick={() => handleSelectSymbol(r.symbol)}
                        className="w-full text-left px-3 py-2 hover:bg-muted flex justify-between items-center"
                      >
                        <span className="font-mono font-medium">{r.symbol}</span>
                        {r.name && (
                          <span className="text-sm text-muted-foreground truncate ml-2 max-w-[150px]">
                            {r.name}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Date Range Picker */}
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal w-[130px]")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateRange.from, "MMM d")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.from}
                    onSelect={(date) => date && setDateRange((prev) => ({ ...prev, from: date }))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <span className="flex items-center text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal w-[130px]")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateRange.to, "MMM d")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.to}
                    onSelect={(date) => date && setDateRange((prev) => ({ ...prev, to: date }))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!selectedSymbol ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            Search and select a symbol to view chart
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No chart data available for {selectedSymbol}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="bucket" tickFormatter={formatXAxis} className="text-xs" />
              <YAxis domain={["auto", "auto"]} tickFormatter={formatTooltipValue} className="text-xs" />
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
              <Line type="monotone" dataKey="close" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

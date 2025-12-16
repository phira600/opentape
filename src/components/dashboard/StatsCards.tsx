import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, TrendingUp, Activity, Clock, RefreshCw } from "lucide-react";

interface Stats {
  totalTrades: number;
  totalSymbols: number;
  totalVenues: number;
  lastFetch: string | null;
  candlesRefresh: {
    refreshedAt: string | null;
    rowsCount: number | null;
    durationMs: number | null;
  };
}

export function StatsCards() {
  const [stats, setStats] = useState<Stats>({
    totalTrades: 0,
    totalSymbols: 0,
    totalVenues: 0,
    lastFetch: null,
    candlesRefresh: {
      refreshedAt: null,
      rowsCount: null,
      durationMs: null,
    },
  });

  const fetchStats = async () => {
    // Get start of today in UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    // Get total trades count for today using exact count
    const { count: tradesCount, error: tradesError } = await supabase
      .from("trades_normalized")
      .select("*", { count: "exact", head: true })
      .gte("trade_time", todayIso);

    if (tradesError) {
      console.error("Error fetching trades count:", tradesError);
    }

    // Get unique symbols from today's trades
    // Using a paginated approach to get all unique symbols
    let allSymbols: string[] = [];
    let allVenues: string[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: tradesData, error } = await supabase
        .from("trades_normalized")
        .select("symbol, venue")
        .gte("trade_time", todayIso)
        .range(offset, offset + batchSize - 1);
      
      if (error || !tradesData || tradesData.length === 0) {
        hasMore = false;
      } else {
        allSymbols = [...allSymbols, ...tradesData.map(t => t.symbol)];
        allVenues = [...allVenues, ...tradesData.map(t => t.venue)];
        offset += batchSize;
        hasMore = tradesData.length === batchSize;
      }
      
      // Limit to 10 batches to avoid infinite loops
      if (offset >= 10000) hasMore = false;
    }

    const uniqueSymbols = new Set(allSymbols);
    const uniqueVenues = new Set(allVenues);

    // Get last fetch time
    const { data: lastJob } = await supabase
      .from("job_configurations")
      .select("last_run_at")
      .order("last_run_at", { ascending: false })
      .limit(1)
      .single();

    // Get latest candles refresh info
    const { data: candlesLog } = await supabase
      .from("mv_refresh_log")
      .select("refreshed_at, rows_count, refresh_duration_ms")
      .eq("view_name", "candles_1min")
      .order("refreshed_at", { ascending: false })
      .limit(1)
      .single();

    setStats({
      totalTrades: tradesCount || 0,
      totalSymbols: uniqueSymbols.size,
      totalVenues: uniqueVenues.size,
      lastFetch: lastJob?.last_run_at || null,
      candlesRefresh: {
        refreshedAt: candlesLog?.refreshed_at || null,
        rowsCount: candlesLog?.rows_count || null,
        durationMs: candlesLog?.refresh_duration_ms || null,
      },
    });
  };

  useEffect(() => {
    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleTimeString();
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNumber(stats.totalTrades)}</div>
          <p className="text-xs text-muted-foreground">Today</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Symbols</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalSymbols}</div>
          <p className="text-xs text-muted-foreground">Unique instruments</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Venues</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalVenues}</div>
          <p className="text-xs text-muted-foreground">Trading venues</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Last Fetch</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatTime(stats.lastFetch)}</div>
          <p className="text-xs text-muted-foreground">Most recent run</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Candles Refresh</CardTitle>
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatTime(stats.candlesRefresh.refreshedAt)}</div>
          <p className="text-xs text-muted-foreground">
            {stats.candlesRefresh.rowsCount !== null 
              ? `${formatNumber(stats.candlesRefresh.rowsCount)} rows` 
              : "No refresh yet"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

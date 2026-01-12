import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, TrendingUp, Activity, Clock, RefreshCw } from "lucide-react";

interface Stats {
  totalTrades: number;
  allTimeTrades: number;
  totalSymbols: number;
  totalVenues: number;
  lastFetch: string | null;
  statsUpdated: string | null;
}

export function StatsCards() {
  const [stats, setStats] = useState<Stats>({
    totalTrades: 0,
    allTimeTrades: 0,
    totalSymbols: 0,
    totalVenues: 0,
    lastFetch: null,
    statsUpdated: null,
  });

  const fetchStats = async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    // OPTIMIZED: Use pre-aggregated daily_stats table (single row read vs full table scan)
    // Using rpc to query daily_stats since types may not be updated yet
    const { data: dailyStats } = await supabase
      .from("daily_stats" as any)
      .select("total_trades, unique_symbols, unique_venues, last_updated")
      .eq("date", todayStr)
      .maybeSingle() as any;

    // Get all-time total by summing daily_stats (fast: ~100-300 rows vs 15.9M)
    const { data: allTimeData } = await supabase
      .from("daily_stats" as any)
      .select("total_trades") as any;

    const allTimeTrades = allTimeData?.reduce(
      (sum: number, day: { total_trades: number | string }) => sum + Number(day.total_trades), 0
    ) || 0;

    // Get last fetch time
    const { data: lastJob } = await supabase
      .from("job_configurations")
      .select("last_run_at")
      .order("last_run_at", { ascending: false })
      .limit(1)
      .single();

    // If daily_stats exists, use it (fast path)
    if (dailyStats) {
      setStats({
        totalTrades: Number(dailyStats.total_trades) || 0,
        allTimeTrades,
        totalSymbols: dailyStats.unique_symbols || 0,
        totalVenues: dailyStats.unique_venues || 0,
        lastFetch: lastJob?.last_run_at || null,
        statsUpdated: dailyStats.last_updated || null,
      });
      return;
    }

    // Fallback: Query trades table directly (slower, but needed if daily_stats not populated)
    console.log("daily_stats not available, falling back to trades query");
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const { count: tradesCount } = await supabase
      .from("trades_normalized")
      .select("*", { count: "exact", head: true })
      .gte("trade_time", todayIso);

    // Get a sample to count unique values (limit to avoid timeout)
    const { data: sampleData } = await supabase
      .from("trades_normalized")
      .select("symbol, venue")
      .gte("trade_time", todayIso)
      .limit(5000);

    const uniqueSymbols = new Set(sampleData?.map(t => t.symbol) || []);
    const uniqueVenues = new Set(sampleData?.map(t => t.venue) || []);

    setStats({
      totalTrades: tradesCount || 0,
      allTimeTrades,
      totalSymbols: uniqueSymbols.size,
      totalVenues: uniqueVenues.size,
      lastFetch: lastJob?.last_run_at || null,
      statsUpdated: null,
    });
  };

  useEffect(() => {
    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    
    // Subscribe to realtime updates for daily_stats
    const channel = supabase
      .channel('daily-stats-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_stats',
        },
        () => {
          // Refetch stats when daily_stats is updated
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today's Trades</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNumber(stats.totalTrades)}</div>
          <p className="text-xs text-muted-foreground">Total: {formatNumber(stats.allTimeTrades)}</p>
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
          <p className="text-xs text-muted-foreground">{formatDate(stats.lastFetch)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Stats Updated</CardTitle>
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatTime(stats.statsUpdated)}</div>
          <p className="text-xs text-muted-foreground">{formatDate(stats.statsUpdated)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
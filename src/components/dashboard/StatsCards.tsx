import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, TrendingUp, Activity, Clock } from "lucide-react";

interface Stats {
  totalTrades: number;
  totalSymbols: number;
  totalVenues: number;
  lastFetch: string | null;
}

export function StatsCards() {
  const [stats, setStats] = useState<Stats>({
    totalTrades: 0,
    totalSymbols: 0,
    totalVenues: 0,
    lastFetch: null,
  });

  const fetchStats = async () => {
    // Get total trades count
    const { count: tradesCount } = await supabase
      .from("trades_normalized")
      .select("*", { count: "exact", head: true });

    // Get unique symbols and venues
    const { data: symbolsData } = await supabase
      .from("trades_normalized")
      .select("symbol, venue")
      .limit(10000);

    // Get last fetch time
    const { data: lastJob } = await supabase
      .from("job_configurations")
      .select("last_run_at")
      .order("last_run_at", { ascending: false })
      .limit(1)
      .single();

    if (symbolsData) {
      const uniqueSymbols = new Set(symbolsData.map((t) => t.symbol));
      const uniqueVenues = new Set(symbolsData.map((t) => t.venue));

      setStats({
        totalTrades: tradesCount || 0,
        totalSymbols: uniqueSymbols.size,
        totalVenues: uniqueVenues.size,
        lastFetch: lastJob?.last_run_at || null,
      });
    }
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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNumber(stats.totalTrades)}</div>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
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
    </div>
  );
}

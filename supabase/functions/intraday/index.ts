import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse parameters from query string or body
    let params: Record<string, string> = {};
    
    if (req.method === "GET") {
      const url = new URL(req.url);
      params = Object.fromEntries(url.searchParams);
    } else {
      params = await req.json().catch(() => ({}));
    }

    const { isin, currency, interval, from, to } = params;

    // Validate required parameters
    if (!isin) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: isin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!currency) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: currency" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetching intraday data for ISIN=${isin}, currency=${currency}`);

    // First, find all symbols matching the ISIN+currency combination across all venues
    const { data: symbols, error: symbolError } = await supabase
      .from("symbology")
      .select("symbol, venue, mic")
      .eq("isin", isin)
      .eq("currency", currency);

    if (symbolError) {
      console.error("Error fetching symbology:", symbolError);
      return new Response(
        JSON.stringify({ error: "Failed to lookup symbol", details: symbolError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!symbols || symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "No symbol found for the given ISIN and currency combination" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get unique symbol names to search for trades
    const symbolNames = [...new Set(symbols.map(s => s.symbol))];
    console.log(`Found symbols: ${symbolNames.join(", ")}`);

    // Parse time range
    const intervalMinutes = interval ? parseInt(interval) : 1;
    const endTime = to ? new Date(to) : new Date();
    const startTime = from ? new Date(from) : new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    // Fetch chart data for all matching symbols across all venues
    let allChartData: any[] = [];
    
    for (const sym of symbolNames) {
      // Try without venue restriction first to get data from any venue
      const { data: chartData, error: chartError } = await supabase.rpc("get_chart_data", {
        p_symbol: sym,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString(),
      });

      if (chartError) {
        console.error(`Error fetching chart data for ${sym}:`, chartError);
        continue;
      }

      if (chartData && chartData.length > 0) {
        console.log(`Found ${chartData.length} data points for symbol ${sym}`);
        allChartData = allChartData.concat(chartData);
      }
    }

    // Also try to find by ISIN directly in trades if symbol lookup failed
    if (allChartData.length === 0) {
      console.log("No chart data found via symbols, checking candles view directly...");
      
      // Query the candles view directly for any symbols
      const { data: directCandles, error: directError } = await supabase
        .from("candles_1min")
        .select("*")
        .in("symbol", symbolNames)
        .gte("bucket", startTime.toISOString())
        .lte("bucket", endTime.toISOString())
        .order("bucket", { ascending: true })
        .limit(1000);
      
      if (!directError && directCandles) {
        allChartData = directCandles.map(c => ({
          bucket: c.bucket,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
        console.log(`Found ${allChartData.length} candles directly`);
      }
    }

    const chartData = allChartData;

    // Aggregate data if interval is greater than 1 minute
    let aggregatedData = chartData || [];
    
    if (intervalMinutes > 1 && chartData && chartData.length > 0) {
      const buckets: Map<string, { open: number; high: number; low: number; close: number; volume: number; timestamp: string }> = new Map();
      
      for (const candle of chartData) {
        const candleTime = new Date(candle.bucket);
        const bucketTime = new Date(
          Math.floor(candleTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
        );
        const bucketKey = bucketTime.toISOString();
        
        const existing = buckets.get(bucketKey);
        if (!existing) {
          buckets.set(bucketKey, {
            timestamp: bucketKey,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          });
        } else {
          existing.high = Math.max(existing.high, candle.high);
          existing.low = Math.min(existing.low, candle.low);
          existing.close = candle.close;
          existing.volume += candle.volume;
        }
      }
      
      aggregatedData = Array.from(buckets.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } else {
      aggregatedData = chartData?.map((c: any) => ({
        timestamp: c.bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })) || [];
    }

    console.log(`Returning ${aggregatedData.length} data points`);

    return new Response(
      JSON.stringify({
        isin,
        currency,
        symbols: symbolNames,
        interval: intervalMinutes,
        from: startTime.toISOString(),
        to: endTime.toISOString(),
        data: aggregatedData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in intraday function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

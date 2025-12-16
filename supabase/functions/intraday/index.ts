import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function validateApiKey(supabase: any, apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  const { data: keyData, error } = await supabase
    .from("api_keys")
    .select("id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();
  
  if (error || !keyData) return false;
  
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyData.id);
  
  return true;
}

// Aggregate trades into minute candles
function aggregateToMinuteCandles(trades: any[], intervalMinutes: number): any[] {
  if (!trades || trades.length === 0) return [];
  
  const buckets: Map<string, { open: number; high: number; low: number; close: number; volume: number; timestamp: string; firstTime: number }> = new Map();
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.trade_time);
    const bucketTime = new Date(
      Math.floor(tradeTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        timestamp: bucketKey,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity || 0,
        firstTime: tradeTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, trade.price);
      existing.low = Math.min(existing.low, trade.price);
      // Update close if this trade is later
      if (tradeTime.getTime() > existing.firstTime) {
        existing.close = trade.price;
      }
      // Update open if this trade is earlier
      if (tradeTime.getTime() < existing.firstTime) {
        existing.open = trade.price;
        existing.firstTime = tradeTime.getTime();
      }
      existing.volume += trade.quantity || 0;
    }
  }
  
  return Array.from(buckets.values())
    .map(({ firstTime, ...rest }) => rest)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate API key
    const apiKey = req.headers.get("x-api-key") || "";
    const isValid = await validateApiKey(supabase, apiKey);
    
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Parse time range
    const intervalMinutes = interval ? parseInt(interval) : 1;
    const now = new Date();
    const startTime = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endTime = to ? new Date(to) : now;

    // Paginate through all trades to avoid the 1000-row default limit
    const pageSize = 1000;
    let allTrades: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: tradesPage, error: tradesError } = await supabase
        .from("trades_normalized")
        .select("price, quantity, trade_time")
        .eq("symbol", isin)
        .gte("trade_time", startTime.toISOString())
        .lte("trade_time", endTime.toISOString())
        .order("trade_time", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (tradesError) {
        console.error("Error fetching trades:", tradesError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch trade data", details: tradesError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (tradesPage && tradesPage.length > 0) {
        allTrades = allTrades.concat(tradesPage);
        hasMore = tradesPage.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }

      // Safety limit: max 50 pages (50,000 trades)
      if (page >= 50) {
        console.log("Reached max pagination limit");
        hasMore = false;
      }
    }

    console.log(`Found ${allTrades.length} trades for ISIN ${isin}`);

    // Aggregate trades into candles
    const aggregatedData = aggregateToMinuteCandles(allTrades, intervalMinutes);

    // Extract last price and timestamp from the most recent data point
    const lastDataPoint = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1] : null;
    const last = lastDataPoint ? lastDataPoint.close : null;
    const lastTimestamp = lastDataPoint ? lastDataPoint.timestamp : null;

    console.log(`Returning ${aggregatedData.length} data points`);

    return new Response(
      JSON.stringify({
        isin,
        currency,
        interval: intervalMinutes,
        from: startTime.toISOString(),
        to: endTime.toISOString(),
        last,
        lastTimestamp,
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

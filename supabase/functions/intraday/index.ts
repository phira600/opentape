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

// Aggregate 1-minute candles into larger intervals
function aggregateCandles(candles: any[], intervalMinutes: number): any[] {
  if (!candles || candles.length === 0) return [];
  if (intervalMinutes === 1) {
    return candles.map(c => ({
      timestamp: c.bucket,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));
  }
  
  const buckets: Map<string, { open: number; high: number; low: number; close: number; volume: number; timestamp: string; firstTime: number }> = new Map();
  
  for (const candle of candles) {
    const candleTime = new Date(candle.bucket);
    const bucketTime = new Date(
      Math.floor(candleTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        timestamp: bucketKey,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        firstTime: candleTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, Number(candle.high));
      existing.low = Math.min(existing.low, Number(candle.low));
      // Update close if this candle is later
      if (candleTime.getTime() > existing.firstTime) {
        existing.close = Number(candle.close);
      }
      // Update open if this candle is earlier  
      if (candleTime.getTime() < existing.firstTime) {
        existing.open = Number(candle.open);
        existing.firstTime = candleTime.getTime();
      }
      existing.volume += Number(candle.volume);
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

    // Query candles_1min materialized view (pre-aggregated data)
    const pageSize = 1000;
    let allCandles: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: candlesPage, error: candlesError } = await supabase
        .from("candles_1min")
        .select("bucket, open, high, low, close, volume, venue")
        .eq("symbol", isin)
        .gte("bucket", startTime.toISOString())
        .lte("bucket", endTime.toISOString())
        .order("bucket", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (candlesError) {
        console.error("Error fetching candles:", candlesError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch candle data", details: candlesError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (candlesPage && candlesPage.length > 0) {
        allCandles = allCandles.concat(candlesPage);
        hasMore = candlesPage.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }

      // Safety limit: max 100 pages (100,000 candles)
      if (page >= 100) {
        console.log("Reached max pagination limit");
        hasMore = false;
      }
    }

    console.log(`Found ${allCandles.length} candles for ISIN ${isin}`);

    // Aggregate candles to requested interval
    const aggregatedData = aggregateCandles(allCandles, intervalMinutes);

    // Extract last price and timestamp from the most recent data point
    const lastDataPoint = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1] : null;
    const last = lastDataPoint ? lastDataPoint.close : null;
    const lastTimestamp = lastDataPoint ? lastDataPoint.timestamp : null;
    const venue = allCandles.length > 0 ? allCandles[0].venue : null;

    console.log(`Returning ${aggregatedData.length} data points`);

    return new Response(
      JSON.stringify({
        isin,
        currency,
        venue,
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

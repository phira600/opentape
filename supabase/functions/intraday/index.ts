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

// Aggregate data into candles
function aggregateToCandles(items: any[], intervalMinutes: number, isCandles: boolean): any[] {
  if (!items || items.length === 0) return [];
  
  // If already 1-min candles and interval is 1, just format
  if (isCandles && intervalMinutes === 1) {
    return items.map(c => ({
      timestamp: c.bucket,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));
  }
  
  const buckets: Map<string, { open: number; high: number; low: number; close: number; volume: number; timestamp: string; firstTime: number }> = new Map();
  
  for (const item of items) {
    const itemTime = new Date(isCandles ? item.bucket : item.trade_time);
    const bucketTime = new Date(
      Math.floor(itemTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const price = isCandles ? Number(item.open) : Number(item.price);
    const high = isCandles ? Number(item.high) : Number(item.price);
    const low = isCandles ? Number(item.low) : Number(item.price);
    const close = isCandles ? Number(item.close) : Number(item.price);
    const volume = isCandles ? Number(item.volume) : Number(item.quantity || 0);
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        timestamp: bucketKey,
        open: price,
        high: high,
        low: low,
        close: close,
        volume: volume,
        firstTime: itemTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      if (itemTime.getTime() > existing.firstTime) {
        existing.close = close;
      }
      if (itemTime.getTime() < existing.firstTime) {
        existing.open = price;
        existing.firstTime = itemTime.getTime();
      }
      existing.volume += volume;
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

    // Parse parameters
    let params: Record<string, string> = {};
    if (req.method === "GET") {
      const url = new URL(req.url);
      params = Object.fromEntries(url.searchParams);
    } else {
      params = await req.json().catch(() => ({}));
    }

    const { isin, currency, interval, from, to } = params;

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

    const intervalMinutes = interval ? parseInt(interval) : 1;
    const now = new Date();
    const startTime = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endTime = to ? new Date(to) : now;

    // Try candles_1min first
    const pageSize = 1000;
    let allData: any[] = [];
    let page = 0;
    let hasMore = true;
    let usedCandles = false;
    let venue: string | null = null;

    // First, try candles_1min view
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
        console.log("Candles query error, will fallback to trades:", candlesError.message);
        break;
      }

      if (candlesPage && candlesPage.length > 0) {
        allData = allData.concat(candlesPage);
        venue = candlesPage[0].venue;
        hasMore = candlesPage.length === pageSize;
        page++;
        usedCandles = true;
      } else {
        hasMore = false;
      }

      if (page >= 100) {
        hasMore = false;
      }
    }

    // If no candles data, fallback to trades_normalized
    if (allData.length === 0) {
      console.log("No candles data, falling back to trades_normalized");
      page = 0;
      hasMore = true;

      while (hasMore) {
        const { data: tradesPage, error: tradesError } = await supabase
          .from("trades_normalized")
          .select("price, quantity, trade_time, venue")
          .eq("symbol", isin)
          .gte("trade_time", startTime.toISOString())
          .lte("trade_time", endTime.toISOString())
          .order("trade_time", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (tradesError) {
          console.error("Trades query error:", tradesError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch data", details: tradesError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (tradesPage && tradesPage.length > 0) {
          allData = allData.concat(tradesPage);
          if (!venue) venue = tradesPage[0].venue;
          hasMore = tradesPage.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }

        if (page >= 50) {
          console.log("Reached max pagination limit for trades");
          hasMore = false;
        }
      }
      usedCandles = false;
    }

    console.log(`Found ${allData.length} ${usedCandles ? 'candles' : 'trades'} for ISIN ${isin}`);

    // Aggregate to requested interval
    const aggregatedData = aggregateToCandles(allData, intervalMinutes, usedCandles);

    const lastDataPoint = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1] : null;
    const last = lastDataPoint ? lastDataPoint.close : null;
    const lastTimestamp = lastDataPoint ? lastDataPoint.timestamp : null;

    console.log(`Returning ${aggregatedData.length} data points (source: ${usedCandles ? 'candles_1min' : 'trades_normalized'})`);

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
        _source: usedCandles ? 'candles_1min' : 'trades_normalized',
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

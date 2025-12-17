import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Cache-Control": "public, max-age=60",
};

// In-memory LRU cache for API key validation (reduces DB queries by ~90%)
const API_KEY_CACHE = new Map<string, { valid: boolean; keyId: string | null; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

// In-memory response cache for intraday data
const RESPONSE_CACHE = new Map<string, { data: any; expires: number }>();
const RESPONSE_CACHE_TTL_MS = 60 * 1000; // 1 minute

function getCachedResponse(key: string): any | null {
  const entry = RESPONSE_CACHE.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  RESPONSE_CACHE.delete(key);
  return null;
}

function setCachedResponse(key: string, data: any) {
  if (RESPONSE_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = RESPONSE_CACHE.keys().next().value;
    if (oldestKey) RESPONSE_CACHE.delete(oldestKey);
  }
  RESPONSE_CACHE.set(key, { data, expires: Date.now() + RESPONSE_CACHE_TTL_MS });
}

async function validateApiKey(supabase: any, apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
  // Check cache first
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expires > Date.now()) {
    if (cached.valid && cached.keyId) {
      EdgeRuntime.waitUntil(
        supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", cached.keyId)
      );
    }
    return cached.valid;
  }
  
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
  
  const isValid = !error && !!keyData;
  
  if (API_KEY_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = API_KEY_CACHE.keys().next().value;
    if (oldestKey) API_KEY_CACHE.delete(oldestKey);
  }
  
  API_KEY_CACHE.set(apiKey, { 
    valid: isValid, 
    keyId: keyData?.id || null, 
    expires: Date.now() + CACHE_TTL_MS 
  });
  
  if (isValid && keyData?.id) {
    EdgeRuntime.waitUntil(
      supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyData.id)
    );
  }
  
  return isValid;
}

// Aggregate candles from all venues into single candles per timestamp
function aggregateCandlesAcrossVenues(candles: any[]): any[] {
  if (!candles || candles.length === 0) return [];
  
  const buckets = new Map<string, { 
    open: number; high: number; low: number; close: number; volume: number; 
    firstTime: number; lastTime: number;
  }>();
  
  for (const candle of candles) {
    const bucketKey = candle.bucket;
    const candleTime = new Date(candle.bucket).getTime();
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume || 0),
        firstTime: candleTime,
        lastTime: candleTime,
      });
    } else {
      // Merge: max high, min low, sum volume
      existing.high = Math.max(existing.high, Number(candle.high));
      existing.low = Math.min(existing.low, Number(candle.low));
      existing.volume += Number(candle.volume || 0);
      // For open/close, use the values from any venue (they should be similar)
      // If we had actual trade times within the candle, we'd use those
    }
  }
  
  return Array.from(buckets.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// Aggregate raw trades into candles at specified interval
function aggregateTradesIntoCandles(trades: any[], intervalMinutes: number): any[] {
  if (!trades || trades.length === 0) return [];
  
  const buckets = new Map<string, { 
    open: number; high: number; low: number; close: number; volume: number;
    firstTime: number;
  }>();
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.trade_time);
    const bucketTime = new Date(
      Math.floor(tradeTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const price = Number(trade.price);
    const volume = Number(trade.quantity || 0);
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volume,
        firstTime: tradeTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.volume += volume;
      if (tradeTime.getTime() > existing.firstTime) {
        existing.close = price;
      }
      if (tradeTime.getTime() < existing.firstTime) {
        existing.open = price;
        existing.firstTime = tradeTime.getTime();
      }
    }
  }
  
  return Array.from(buckets.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// Re-aggregate 1-min candles into larger intervals
function reaggregateCandlesToInterval(candles: any[], intervalMinutes: number): any[] {
  if (intervalMinutes === 1) return candles;
  
  const buckets = new Map<string, { 
    open: number; high: number; low: number; close: number; volume: number;
    firstTime: number;
  }>();
  
  for (const candle of candles) {
    const candleTime = new Date(candle.timestamp);
    const bucketTime = new Date(
      Math.floor(candleTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        firstTime: candleTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.volume += candle.volume;
      if (candleTime.getTime() > existing.firstTime) {
        existing.close = candle.close;
      }
      if (candleTime.getTime() < existing.firstTime) {
        existing.open = candle.open;
        existing.firstTime = candleTime.getTime();
      }
    }
  }
  
  return Array.from(buckets.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
    }))
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

    const intervalMinutes = interval ? parseInt(interval) : 1;
    const now = new Date();
    const startTime = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endTime = to ? new Date(to) : now;

    // Check response cache
    const cacheKey = `intraday:${isin}:${currency}:${intervalMinutes}:${startTime.toISOString().slice(0,13)}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for ${cacheKey}`);
      return new Response(
        JSON.stringify(cachedResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" } }
      );
    }

    console.log(`Fetching intraday data for ISIN=${isin}, currency=${currency}`);

    // Look up instrument info from symbology
    const { data: symbologyData, error: symbologyError } = await supabase
      .from("symbology")
      .select("name")
      .eq("isin", isin)
      .eq("currency", currency)
      .limit(1)
      .maybeSingle();

    if (symbologyError) {
      console.error("Symbology lookup error:", symbologyError);
    }

    const symbolName = symbologyData?.name || null;
    console.log(`Symbology lookup: ISIN=${isin}, currency=${currency} -> name=${symbolName}`);

    const pageSize = 1000;
    let allCandles: any[] = [];
    let page = 0;
    let hasMore = true;
    let usedCandles = false;

    // Fetch candles from ALL venues for this ISIN (no venue filter)
    while (hasMore) {
      const { data: candlesPage, error: candlesError } = await supabase
        .from("candles_1min")
        .select("bucket, open, high, low, close, volume")
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
        allCandles = allCandles.concat(candlesPage);
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

    let aggregatedData: any[] = [];

    if (allCandles.length > 0) {
      // Aggregate candles across all venues
      const mergedCandles = aggregateCandlesAcrossVenues(allCandles);
      // Re-aggregate to requested interval if needed
      aggregatedData = reaggregateCandlesToInterval(mergedCandles, intervalMinutes);
      console.log(`Found ${allCandles.length} raw candles, merged to ${mergedCandles.length} candles for ISIN ${isin}`);
    } else {
      // Fallback to trades_normalized
      console.log("No candles data, falling back to trades_normalized");
      let allTrades: any[] = [];
      page = 0;
      hasMore = true;

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
          console.error("Trades query error:", tradesError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch data", details: tradesError.message }),
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

        if (page >= 50) {
          console.log("Reached max pagination limit for trades");
          hasMore = false;
        }
      }

      aggregatedData = aggregateTradesIntoCandles(allTrades, intervalMinutes);
      usedCandles = false;
      console.log(`Found ${allTrades.length} trades, aggregated to ${aggregatedData.length} candles`);
    }

    const lastDataPoint = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1] : null;
    const last = lastDataPoint ? lastDataPoint.close : null;
    const lastTimestamp = lastDataPoint ? lastDataPoint.timestamp : null;

    console.log(`Returning ${aggregatedData.length} data points (source: ${usedCandles ? 'candles_1min' : 'trades_normalized'})`);

    const responseData = {
      isin,
      currency,
      name: symbolName,
      interval: intervalMinutes,
      from: startTime.toISOString(),
      to: endTime.toISOString(),
      last,
      lastTimestamp,
      data: aggregatedData,
      _source: usedCandles ? 'candles_1min' : 'trades_normalized',
    };

    setCachedResponse(cacheKey, responseData);

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" } }
    );
  } catch (error) {
    console.error("Error in intraday function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

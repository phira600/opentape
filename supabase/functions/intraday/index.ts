import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Cache-Control": "public, max-age=60",
};

// In-memory LRU cache for API key validation
const API_KEY_CACHE = new Map<string, { valid: boolean; keyId: string | null; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

// In-memory response cache
const RESPONSE_CACHE = new Map<string, { data: any; expires: number }>();
const RESPONSE_CACHE_TTL_MS = 60 * 1000;

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

// Re-aggregate 1-min candles into larger intervals
function reaggregateCandlesToInterval(candles: any[], intervalMinutes: number): any[] {
  if (intervalMinutes === 1) {
    return candles.map(c => ({
      timestamp: c.bucket,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    }));
  }
  
  const buckets = new Map<string, { 
    open: number; high: number; low: number; close: number; volume: number;
    firstTime: number;
  }>();
  
  for (const candle of candles) {
    const candleTime = new Date(candle.bucket);
    const bucketTime = new Date(
      Math.floor(candleTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
    );
    const bucketKey = bucketTime.toISOString();
    
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume || 0),
        firstTime: candleTime.getTime(),
      });
    } else {
      existing.high = Math.max(existing.high, Number(candle.high));
      existing.low = Math.min(existing.low, Number(candle.low));
      existing.volume += Number(candle.volume || 0);
      if (candleTime.getTime() > existing.firstTime) {
        existing.close = Number(candle.close);
      }
      if (candleTime.getTime() < existing.firstTime) {
        existing.open = Number(candle.open);
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

    const apiKey = req.headers.get("x-api-key") || "";
    const isValid = await validateApiKey(supabase, apiKey);
    
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Look up instrument name from symbology
    const { data: symbologyData } = await supabase
      .from("symbology")
      .select("name")
      .eq("isin", isin)
      .eq("currency", currency)
      .limit(1)
      .maybeSingle();

    const symbolName = symbologyData?.name || null;

    // Query candles directly by ISIN and currency
    const pageSize = 1000;
    let allCandles: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: candlesPage, error: candlesError } = await supabase
        .from("candles_1min")
        .select("bucket, open, high, low, close, volume")
        .eq("symbol", isin)
        .eq("currency", currency)
        .gte("bucket", startTime.toISOString())
        .lte("bucket", endTime.toISOString())
        .order("bucket", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (candlesError) {
        console.error("Candles query error:", candlesError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch candles", details: candlesError.message }),
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

      if (page >= 100) hasMore = false;
    }

    const aggregatedData = reaggregateCandlesToInterval(allCandles, intervalMinutes);
    
    const lastDataPoint = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1] : null;
    const last = lastDataPoint ? lastDataPoint.close : null;
    const lastTimestamp = lastDataPoint ? lastDataPoint.timestamp : null;

    console.log(`Returning ${aggregatedData.length} candles for ${isin}:${currency}`);

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
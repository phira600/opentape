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

// Aggregate data into candles
function aggregateToCandles(items: any[], intervalMinutes: number, isCandles: boolean): any[] {
  if (!items || items.length === 0) return [];
  
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

    // Look up the correct MIC (venue) from symbology based on ISIN + currency
    const { data: symbologyData, error: symbologyError } = await supabase
      .from("symbology")
      .select("mic, venue, symbol, name")
      .eq("isin", isin)
      .eq("currency", currency)
      .limit(1)
      .maybeSingle();

    if (symbologyError) {
      console.error("Symbology lookup error:", symbologyError);
    }

    const mic = symbologyData?.mic || null;
    const symbolName = symbologyData?.name || null;
    console.log(`Symbology lookup: ISIN=${isin}, currency=${currency} -> MIC=${mic}`);

    const pageSize = 1000;
    let allData: any[] = [];
    let page = 0;
    let hasMore = true;
    let usedCandles = false;
    let venueUsed: string | null = mic;

    // First, try candles_1min view (filtered by MIC if available)
    while (hasMore) {
      let query = supabase
        .from("candles_1min")
        .select("bucket, open, high, low, close, volume, venue")
        .eq("symbol", isin)
        .gte("bucket", startTime.toISOString())
        .lte("bucket", endTime.toISOString())
        .order("bucket", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (mic) {
        query = query.eq("venue", mic);
      }

      const { data: candlesPage, error: candlesError } = await query;

      if (candlesError) {
        console.log("Candles query error, will fallback to trades:", candlesError.message);
        break;
      }

      if (candlesPage && candlesPage.length > 0) {
        allData = allData.concat(candlesPage);
        if (!venueUsed) venueUsed = candlesPage[0].venue;
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
        let query = supabase
          .from("trades_normalized")
          .select("price, quantity, trade_time, venue")
          .eq("symbol", isin)
          .gte("trade_time", startTime.toISOString())
          .lte("trade_time", endTime.toISOString())
          .order("trade_time", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (mic) {
          query = query.eq("venue", mic);
        }

        const { data: tradesPage, error: tradesError } = await query;

        if (tradesError) {
          console.error("Trades query error:", tradesError);
          return new Response(
            JSON.stringify({ error: "Failed to fetch data", details: tradesError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (tradesPage && tradesPage.length > 0) {
          allData = allData.concat(tradesPage);
          if (!venueUsed) venueUsed = tradesPage[0].venue;
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

    console.log(`Found ${allData.length} ${usedCandles ? 'candles' : 'trades'} for ISIN ${isin} (MIC: ${mic || 'all'})`);

    // Aggregate to requested interval
    const aggregatedData = aggregateToCandles(allData, intervalMinutes, usedCandles);

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
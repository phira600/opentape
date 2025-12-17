import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Cache-Control": "public, max-age=60",
};

interface QuoteResult {
  isin: string;
  currency: string;
  name: string | null;
  last: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  timestamp: string;
}

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

    const { isins } = params;

    if (!isins) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: isins (format: ISIN:CURRENCY or comma-separated list)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cacheKey = `quotes:${isins}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for ${cacheKey}`);
      return new Response(
        JSON.stringify(cachedResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" } }
      );
    }

    console.log(`Fetching quotes for: ${isins}`);

    // Parse ISIN:Currency pairs
    const pairs: { isin: string; currency: string }[] = [];
    const isinList = isins.split(",").map((s: string) => s.trim());
    
    for (const item of isinList) {
      if (item.includes(":")) {
        const [isin, currency] = item.split(":");
        pairs.push({ isin: isin.trim(), currency: currency.trim() });
      } else {
        // ISIN without currency - look up from symbology
        const { data: symData } = await supabase
          .from("symbology")
          .select("isin, currency")
          .eq("isin", item.trim())
          .not("currency", "is", null)
          .limit(1)
          .maybeSingle();
        
        if (symData) {
          pairs.push({ isin: symData.isin, currency: symData.currency });
        } else {
          console.log(`No symbology found for ISIN ${item}, skipping`);
        }
      }
    }

    if (pairs.length === 0) {
      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: "No valid ISIN:Currency pairs found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${pairs.length} ISIN:Currency pairs`);

    // Get the latest candle for each pair from candles_1min
    const quotes: QuoteResult[] = [];

    for (const pair of pairs) {
      // Get latest candle for this ISIN:Currency
      const { data: latestCandle, error: candleError } = await supabase
        .from("candles_1min")
        .select("bucket, open, high, low, close, volume")
        .eq("symbol", pair.isin)
        .eq("currency", pair.currency)
        .order("bucket", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (candleError) {
        console.error(`Error fetching candle for ${pair.isin}:${pair.currency}:`, candleError);
        continue;
      }

      if (!latestCandle) {
        console.log(`No candle data for ${pair.isin}:${pair.currency}`);
        continue;
      }

      // Get the day's aggregated stats
      const today = new Date();
      const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0)).toISOString();

      const { data: dayCandles } = await supabase
        .from("candles_1min")
        .select("open, high, low, volume, bucket")
        .eq("symbol", pair.isin)
        .eq("currency", pair.currency)
        .gte("bucket", startOfDay)
        .order("bucket", { ascending: true });

      let dayOpen = Number(latestCandle.open);
      let dayHigh = Number(latestCandle.high);
      let dayLow = Number(latestCandle.low);
      let dayVolume = Number(latestCandle.volume || 0);

      if (dayCandles && dayCandles.length > 0) {
        dayOpen = Number(dayCandles[0].open);
        dayHigh = Math.max(...dayCandles.map(c => Number(c.high)));
        dayLow = Math.min(...dayCandles.map(c => Number(c.low)));
        dayVolume = dayCandles.reduce((sum, c) => sum + Number(c.volume || 0), 0);
      }

      // Look up name from symbology
      const { data: symData } = await supabase
        .from("symbology")
        .select("name")
        .eq("isin", pair.isin)
        .eq("currency", pair.currency)
        .limit(1)
        .maybeSingle();

      quotes.push({
        isin: pair.isin,
        currency: pair.currency,
        name: symData?.name || null,
        last: Number(latestCandle.close),
        high: dayHigh,
        low: dayLow,
        open: dayOpen,
        volume: dayVolume,
        timestamp: latestCandle.bucket,
      });
    }

    console.log(`Returning ${quotes.length} quotes`);

    const responseData = { quotes, count: quotes.length };
    setCachedResponse(cacheKey, responseData);

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" } }
    );
  } catch (error) {
    console.error("Error in quotes function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
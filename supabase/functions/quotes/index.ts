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

interface IsinCurrencyPair {
  isin: string;
  currency: string;
  name?: string | null;
}

// In-memory LRU cache for API key validation
const API_KEY_CACHE = new Map<string, { valid: boolean; keyId: string | null; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

// In-memory response cache for quotes
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

// Aggregate trades into OHLCV data (across all venues)
function aggregateTrades(trades: any[]): { open: number; high: number; low: number; close: number; volume: number; timestamp: string } | null {
  if (!trades || trades.length === 0) return null;
  
  const sorted = [...trades].sort((a, b) => new Date(a.trade_time).getTime() - new Date(b.trade_time).getTime());
  
  return {
    open: Number(sorted[0].price),
    high: Math.max(...sorted.map(t => Number(t.price))),
    low: Math.min(...sorted.map(t => Number(t.price))),
    close: Number(sorted[sorted.length - 1].price),
    volume: sorted.reduce((sum, t) => sum + Number(t.quantity || 0), 0),
    timestamp: sorted[sorted.length - 1].trade_time,
  };
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

    const { isins, mic } = params;

    // Check response cache
    const cacheKey = `quotes:${isins || ''}:${mic || ''}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for ${cacheKey}`);
      return new Response(
        JSON.stringify(cachedResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" } }
      );
    }

    console.log(`Fetching quotes: isins=${isins}, mic=${mic}`);

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0)).toISOString();

    // Build list of ISIN+Currency pairs to query
    const isinPairs: IsinCurrencyPair[] = [];

    // If MIC provided, look up all unique ISIN+Currency pairs for that MIC from symbology
    if (mic) {
      console.log(`Looking up ISIN+Currency pairs for MIC ${mic}`);
      
      const { data: micSymbology, error: micError } = await supabase
        .from("symbology")
        .select("isin, currency, name")
        .eq("mic", mic)
        .not("isin", "is", null)
        .not("currency", "is", null);

      if (micError) {
        console.error("Error fetching symbology for MIC:", micError);
        return new Response(
          JSON.stringify({ quotes: [], count: 0, error: micError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (micSymbology && micSymbology.length > 0) {
        // Get unique ISIN+Currency pairs
        const seen = new Set<string>();
        for (const sym of micSymbology) {
          const key = `${sym.isin}:${sym.currency}`;
          if (!seen.has(key)) {
            seen.add(key);
            isinPairs.push({ isin: sym.isin, currency: sym.currency, name: sym.name });
          }
        }
        console.log(`Found ${isinPairs.length} unique ISIN+Currency pairs for MIC ${mic}`);
      } else {
        console.log(`No symbology entries found for MIC ${mic}`);
      }
    }

    // Also parse explicit ISINs from the isins parameter
    if (isins) {
      const isinList = isins.split(",").map((s) => s.trim());
      for (const item of isinList) {
        if (item.includes(":")) {
          const [isin, currency] = item.split(":");
          // Check if already in list
          const key = `${isin.trim()}:${currency.trim()}`;
          if (!isinPairs.some(p => `${p.isin}:${p.currency}` === key)) {
            isinPairs.push({ isin: isin.trim(), currency: currency.trim() });
          }
        } else {
          // ISIN without currency - look up from symbology
          const { data: symData } = await supabase
            .from("symbology")
            .select("isin, currency, name")
            .eq("isin", item.trim())
            .not("currency", "is", null)
            .limit(1)
            .maybeSingle();
          
          if (symData) {
            const key = `${symData.isin}:${symData.currency}`;
            if (!isinPairs.some(p => `${p.isin}:${p.currency}` === key)) {
              isinPairs.push({ isin: symData.isin, currency: symData.currency, name: symData.name });
            }
          }
        }
      }
    }

    if (isinPairs.length === 0) {
      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: "No valid ISIN+Currency pairs found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${isinPairs.length} ISIN+Currency pairs`);

    // Fetch all trades for all ISINs in one query (across ALL venues)
    const uniqueIsins = [...new Set(isinPairs.map(p => p.isin))];
    
    const { data: allTrades, error: tradesError } = await supabase
      .from("trades_normalized")
      .select("symbol, price, quantity, trade_time")
      .in("symbol", uniqueIsins)
      .gte("trade_time", startOfDay)
      .order("trade_time", { ascending: true });

    if (tradesError) {
      console.error("Error fetching trades:", tradesError);
      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: tradesError.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group trades by ISIN
    const tradesByIsin = new Map<string, any[]>();
    for (const trade of (allTrades || [])) {
      const existing = tradesByIsin.get(trade.symbol) || [];
      existing.push(trade);
      tradesByIsin.set(trade.symbol, existing);
    }

    // Look up names for pairs that don't have them
    const pairsNeedingNames = isinPairs.filter(p => !p.name);
    if (pairsNeedingNames.length > 0) {
      const { data: nameData } = await supabase
        .from("symbology")
        .select("isin, currency, name")
        .in("isin", pairsNeedingNames.map(p => p.isin));
      
      if (nameData) {
        const nameMap = new Map<string, string>();
        for (const n of nameData) {
          nameMap.set(`${n.isin}:${n.currency}`, n.name);
        }
        for (const pair of pairsNeedingNames) {
          pair.name = nameMap.get(`${pair.isin}:${pair.currency}`) || null;
        }
      }
    }

    // Build quotes
    const quotes: QuoteResult[] = [];
    for (const pair of isinPairs) {
      const trades = tradesByIsin.get(pair.isin);
      const agg = aggregateTrades(trades || []);
      
      if (!agg) {
        console.log(`No trade data for ${pair.isin}:${pair.currency}`);
        continue;
      }

      quotes.push({
        isin: pair.isin,
        currency: pair.currency,
        name: pair.name || null,
        last: agg.close,
        high: agg.high,
        low: agg.low,
        open: agg.open,
        volume: agg.volume,
        timestamp: agg.timestamp,
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

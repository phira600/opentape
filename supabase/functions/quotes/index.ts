import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  corsHeaders, 
  validateApiKey, 
  checkIpWhitelist, 
  getClientIp,
  getCachedResponse,
  setCachedResponse,
  errorResponse,
  jsonResponse
} from "../_shared/api-utils.ts";

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
    const { valid, keyId } = await validateApiKey(supabase, apiKey);
    
    if (!valid) {
      return errorResponse("Invalid or missing API key", 401);
    }

    // Check IP whitelist (now cached)
    const clientIp = getClientIp(req);
    if (keyId) {
      const ipAllowed = await checkIpWhitelist(supabase, keyId, clientIp);
      if (!ipAllowed) {
        console.log(`IP ${clientIp} not allowed for API key ${keyId}`);
        return errorResponse("IP address not allowed", 403);
      }
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
      return errorResponse("Missing required parameter: isins (format: ISIN:CURRENCY or comma-separated list)", 400);
    }

    // Check response cache
    const cacheKey = `quotes:${isins}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for ${cacheKey}`);
      return jsonResponse(cachedResponse, true);
    }

    console.log(`Fetching quotes for: ${isins}`);

    // Parse ISIN:Currency pairs
    const isinList = isins.split(",").map((s: string) => s.trim());
    const pairsWithCurrency: { isin: string; currency: string }[] = [];
    const isinsWithoutCurrency: string[] = [];
    
    for (const item of isinList) {
      if (item.includes(":")) {
        const [isin, currency] = item.split(":");
        pairsWithCurrency.push({ isin: isin.trim(), currency: currency.trim() });
      } else {
        isinsWithoutCurrency.push(item.trim());
      }
    }

    // Batch lookup for ISINs without currency (single query instead of N queries)
    if (isinsWithoutCurrency.length > 0) {
      const { data: symData } = await supabase
        .from("symbology")
        .select("isin, currency")
        .in("isin", isinsWithoutCurrency)
        .not("currency", "is", null);
      
      if (symData) {
        // Create a map of ISIN to currency (use first found)
        const isinCurrencyMap = new Map<string, string>();
        for (const row of symData) {
          if (!isinCurrencyMap.has(row.isin)) {
            isinCurrencyMap.set(row.isin, row.currency);
          }
        }
        
        for (const isin of isinsWithoutCurrency) {
          const currency = isinCurrencyMap.get(isin);
          if (currency) {
            pairsWithCurrency.push({ isin, currency });
          } else {
            console.log(`No symbology found for ISIN ${isin}, skipping`);
          }
        }
      }
    }

    if (pairsWithCurrency.length === 0) {
      return jsonResponse({ quotes: [], count: 0, error: "No valid ISIN:Currency pairs found" });
    }

    console.log(`Processing ${pairsWithCurrency.length} ISIN:Currency pairs`);

    // Build OR conditions for batch queries
    const allIsins = [...new Set(pairsWithCurrency.map(p => p.isin))];
    const allCurrencies = [...new Set(pairsWithCurrency.map(p => p.currency))];
    
    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0)).toISOString();

    // Execute all queries in parallel (3 queries instead of 40+)
    const [latestCandlesResult, dayCandlesResult, symbologyResult] = await Promise.all([
      // Get latest candle for each ISIN:Currency pair
      supabase
        .from("candles_1min")
        .select("symbol, currency, bucket, open, high, low, close, volume")
        .in("symbol", allIsins)
        .in("currency", allCurrencies)
        .order("bucket", { ascending: false })
        .limit(pairsWithCurrency.length * 2), // Get enough to find latest for each pair
      
      // Get day candles for aggregation
      supabase
        .from("candles_1min")
        .select("symbol, currency, open, high, low, volume, bucket")
        .in("symbol", allIsins)
        .in("currency", allCurrencies)
        .gte("bucket", startOfDay)
        .order("bucket", { ascending: true }),
      
      // Get names from symbology
      supabase
        .from("symbology")
        .select("isin, currency, name")
        .in("isin", allIsins)
    ]);

    // Build lookup maps for efficient access
    const latestCandleMap = new Map<string, any>();
    if (latestCandlesResult.data) {
      for (const candle of latestCandlesResult.data) {
        const key = `${candle.symbol}:${candle.currency}`;
        if (!latestCandleMap.has(key)) {
          latestCandleMap.set(key, candle);
        }
      }
    }

    const dayCandlesMap = new Map<string, any[]>();
    if (dayCandlesResult.data) {
      for (const candle of dayCandlesResult.data) {
        const key = `${candle.symbol}:${candle.currency}`;
        if (!dayCandlesMap.has(key)) {
          dayCandlesMap.set(key, []);
        }
        dayCandlesMap.get(key)!.push(candle);
      }
    }

    const nameMap = new Map<string, string>();
    if (symbologyResult.data) {
      for (const row of symbologyResult.data) {
        const key = `${row.isin}:${row.currency}`;
        if (!nameMap.has(key) && row.name) {
          nameMap.set(key, row.name);
        }
        // Also set by ISIN only as fallback
        if (!nameMap.has(row.isin) && row.name) {
          nameMap.set(row.isin, row.name);
        }
      }
    }

    // Build quotes from maps
    const quotes: QuoteResult[] = [];

    for (const pair of pairsWithCurrency) {
      const key = `${pair.isin}:${pair.currency}`;
      const latestCandle = latestCandleMap.get(key);
      
      if (!latestCandle) {
        console.log(`No candle data for ${key}`);
        continue;
      }

      const dayCandles = dayCandlesMap.get(key) || [];
      
      let dayOpen = Number(latestCandle.open);
      let dayHigh = Number(latestCandle.high);
      let dayLow = Number(latestCandle.low);
      let dayVolume = Number(latestCandle.volume || 0);

      if (dayCandles.length > 0) {
        dayOpen = Number(dayCandles[0].open);
        dayHigh = Math.max(...dayCandles.map(c => Number(c.high)));
        dayLow = Math.min(...dayCandles.map(c => Number(c.low)));
        dayVolume = dayCandles.reduce((sum, c) => sum + Number(c.volume || 0), 0);
      }

      quotes.push({
        isin: pair.isin,
        currency: pair.currency,
        name: nameMap.get(key) || nameMap.get(pair.isin) || null,
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

    return jsonResponse(responseData, false);
  } catch (error) {
    console.error("Error in quotes function:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

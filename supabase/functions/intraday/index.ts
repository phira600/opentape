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

    const { isin, currency, interval, from, to } = params;

    if (!isin) {
      return errorResponse("Missing required parameter: isin", 400);
    }

    if (!currency) {
      return errorResponse("Missing required parameter: currency", 400);
    }

    const intervalMinutes = interval ? parseInt(interval) : 1;
    const now = new Date();
    const startTime = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endTime = to ? new Date(to) : now;

    const cacheKey = `intraday:${isin}:${currency}:${intervalMinutes}:${startTime.toISOString().slice(0,13)}`;
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Cache hit for ${cacheKey}`);
      return jsonResponse(cachedResponse, true);
    }

    console.log(`Fetching intraday data for ISIN=${isin}, currency=${currency}`);

    // Look up instrument name from symbology - use Promise.all for parallel symbology lookup
    const symbologyPromise = supabase
      .from("symbology")
      .select("name")
      .eq("isin", isin)
      .eq("currency", currency)
      .limit(1)
      .maybeSingle();

    const fallbackSymbologyPromise = supabase
      .from("symbology")
      .select("name")
      .eq("isin", isin)
      .limit(1)
      .maybeSingle();

    // Increased page size from 1000 to 5000 for fewer round trips
    const pageSize = 5000;
    let allCandles: any[] = [];
    let page = 0;
    let hasMore = true;

    // First page fetch
    const { data: firstPage, error: firstError } = await supabase
      .from("candles_1min")
      .select("bucket, open, high, low, close, volume")
      .eq("symbol", isin)
      .eq("currency", currency)
      .gte("bucket", startTime.toISOString())
      .lte("bucket", endTime.toISOString())
      .order("bucket", { ascending: true })
      .range(0, pageSize - 1);

    if (firstError) {
      console.error("Candles query error:", firstError);
      return errorResponse(`Failed to fetch candles: ${firstError.message}`, 500);
    }

    if (firstPage) {
      allCandles = firstPage;
      hasMore = firstPage.length === pageSize;
      page = 1;
    }

    // Continue pagination if needed (with larger page size, this happens less often)
    while (hasMore && page < 20) { // Reduced max pages from 100 to 20 with 5000 page size
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
        break;
      }

      if (candlesPage && candlesPage.length > 0) {
        allCandles = allCandles.concat(candlesPage);
        hasMore = candlesPage.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    // Resolve symbology lookup
    const [symbologyData, fallbackData] = await Promise.all([symbologyPromise, fallbackSymbologyPromise]);
    const symbolName = symbologyData.data?.name || fallbackData.data?.name || null;

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

    return jsonResponse(responseData, false);
  } catch (error) {
    console.error("Error in intraday function:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

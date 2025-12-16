import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function validateApiKey(supabase: any, apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
  // Hash the API key using SubtleCrypto
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
  
  // Update last_used_at
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyData.id);
  
  return true;
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
    // Default startTime to 00:00 UTC of today
    const now = new Date();
    const startTime = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    // If no "to" provided, return everything from startTime to now
    const endTime = to ? new Date(to) : now;

    // Trades use ISIN directly as the symbol column
    // Query candles_1min directly using ISIN as the symbol
    const { data: chartData, error: chartError } = await supabase.rpc("get_chart_data", {
      p_symbol: isin,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString(),
    });

    if (chartError) {
      console.error("Error fetching chart data:", chartError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch chart data", details: chartError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${chartData?.length || 0} data points for ISIN ${isin}`);

    // Aggregate data if interval is greater than 1 minute
    let aggregatedData = chartData || [];
    
    if (intervalMinutes > 1 && chartData && chartData.length > 0) {
      const buckets: Map<string, { open: number; high: number; low: number; close: number; volume: number; timestamp: string }> = new Map();
      
      for (const candle of chartData) {
        const candleTime = new Date(candle.bucket);
        const bucketTime = new Date(
          Math.floor(candleTime.getTime() / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000
        );
        const bucketKey = bucketTime.toISOString();
        
        const existing = buckets.get(bucketKey);
        if (!existing) {
          buckets.set(bucketKey, {
            timestamp: bucketKey,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          });
        } else {
          existing.high = Math.max(existing.high, candle.high);
          existing.low = Math.min(existing.low, candle.low);
          existing.close = candle.close;
          existing.volume += candle.volume;
        }
      }
      
      aggregatedData = Array.from(buckets.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } else {
      aggregatedData = chartData?.map((c: any) => ({
        timestamp: c.bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })) || [];
    }

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

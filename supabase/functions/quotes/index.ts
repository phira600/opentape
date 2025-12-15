import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteResult {
  isin: string;
  currency: string;
  symbol: string;
  venue: string;
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

    // Parse parameters from query string or body
    let params: Record<string, string> = {};
    
    if (req.method === "GET") {
      const url = new URL(req.url);
      params = Object.fromEntries(url.searchParams);
    } else {
      params = await req.json().catch(() => ({}));
    }

    const { isins, currency, venue } = params;

    console.log(`Fetching quotes for isins=${isins}, currency=${currency}, venue=${venue}`);

    // Build query for symbology
    let symbolQuery = supabase
      .from("symbology")
      .select("symbol, isin, name, venue, currency, mic");

    // Filter by ISINs if provided (comma-separated list)
    if (isins) {
      const isinList = isins.split(",").map((s) => s.trim());
      symbolQuery = symbolQuery.in("isin", isinList);
    }

    if (currency) {
      symbolQuery = symbolQuery.eq("currency", currency);
    }

    if (venue) {
      symbolQuery = symbolQuery.eq("venue", venue);
    }

    const { data: symbols, error: symbolError } = await symbolQuery.limit(100);

    if (symbolError) {
      console.error("Error fetching symbology:", symbolError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch symbols", details: symbolError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!symbols || symbols.length === 0) {
      return new Response(
        JSON.stringify({ quotes: [], count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${symbols.length} symbols`);

    // Get today's data for each symbol
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const quotes: QuoteResult[] = [];

    for (const sym of symbols) {
      // Get chart data for the symbol
      const { data: chartData, error: chartError } = await supabase.rpc("get_chart_data", {
        p_symbol: sym.symbol,
        p_venue: sym.venue,
        p_start_time: startOfDay,
        p_end_time: new Date().toISOString(),
      });

      if (chartError) {
        console.error(`Error fetching data for ${sym.symbol}:`, chartError);
        continue;
      }

      if (!chartData || chartData.length === 0) {
        continue;
      }

      // Calculate OHLC from the day's data
      const dayOpen = chartData[0].open;
      const dayHigh = Math.max(...chartData.map((c: any) => c.high));
      const dayLow = Math.min(...chartData.map((c: any) => c.low));
      const dayClose = chartData[chartData.length - 1].close;
      const dayVolume = chartData.reduce((sum: number, c: any) => sum + (c.volume || 0), 0);
      const lastTimestamp = chartData[chartData.length - 1].bucket;

      quotes.push({
        isin: sym.isin || "",
        currency: sym.currency || "",
        symbol: sym.symbol,
        venue: sym.venue,
        name: sym.name,
        last: dayClose,
        high: dayHigh,
        low: dayLow,
        open: dayOpen,
        volume: dayVolume,
        timestamp: lastTimestamp,
      });
    }

    console.log(`Returning ${quotes.length} quotes`);

    return new Response(
      JSON.stringify({
        quotes,
        count: quotes.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in quotes function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

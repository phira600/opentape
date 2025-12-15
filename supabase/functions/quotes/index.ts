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
  mic: string | null;
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

    const { isins, mic } = params;

    console.log(`Fetching quotes: isins=${isins}, mic=${mic}`);

    // Parse ISINs with optional currency: "SE0022419784:SEK,GB0000000001:GBP" or just "SE0022419784,GB0000000001"
    const isinPairs: IsinCurrencyPair[] = [];
    
    if (isins) {
      const isinList = isins.split(",").map((s) => s.trim());
      for (const item of isinList) {
        if (item.includes(":")) {
          const [isin, currency] = item.split(":");
          isinPairs.push({ isin: isin.trim(), currency: currency.trim() });
        } else {
          isinPairs.push({ isin: item, currency: "" });
        }
      }
    }

    // If only MIC provided, fetch all ISINs for that MIC
    if (isinPairs.length === 0 && mic) {
      const { data: micData, error: micError } = await supabase
        .from("symbology")
        .select("isin, currency")
        .eq("mic", mic)
        .not("isin", "is", null);

      if (micError) {
        console.error("Error fetching MIC data:", micError);
        return new Response(
          JSON.stringify({ quotes: [], count: 0, error: micError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (micData) {
        for (const row of micData) {
          if (row.isin) {
            isinPairs.push({ isin: row.isin, currency: row.currency || "" });
          }
        }
      }
    }

    if (isinPairs.length === 0) {
      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: "No ISINs provided or found for MIC" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${isinPairs.length} ISIN/currency pairs`);

    // Get today's data
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const quotes: QuoteResult[] = [];

    for (const pair of isinPairs) {
      // Get symbology info for this ISIN
      let query = supabase
        .from("symbology")
        .select("name, currency, mic")
        .eq("isin", pair.isin);

      // If currency specified, filter by it
      if (pair.currency) {
        query = query.eq("currency", pair.currency);
      }

      const { data: symData } = await query.limit(1).maybeSingle();

      if (!symData) {
        console.log(`No symbology found for ISIN ${pair.isin} with currency ${pair.currency || 'any'}`);
        continue;
      }

      // Get chart data using ISIN as the symbol
      const { data: chartData, error: chartError } = await supabase.rpc("get_chart_data", {
        p_symbol: pair.isin,
        p_venue: null,
        p_start_time: startOfDay,
        p_end_time: new Date().toISOString(),
      });

      if (chartError) {
        console.error(`Error fetching data for ${pair.isin}:`, chartError);
        continue;
      }

      if (!chartData || chartData.length === 0) {
        console.log(`No chart data for ${pair.isin}`);
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
        isin: pair.isin,
        currency: symData.currency || pair.currency || "",
        symbol: pair.isin,
        mic: symData.mic,
        name: symData.name,
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

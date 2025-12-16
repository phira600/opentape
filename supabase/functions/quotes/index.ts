import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
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

async function validateApiKey(supabase: any, apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
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
  
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyData.id);
  
  return true;
}

// Aggregate trades into OHLCV data
function aggregateTrades(trades: any[] | undefined): { open: number; high: number; low: number; close: number; volume: number; timestamp: string } | null {
  if (!trades || trades.length === 0) return null;
  
  const sorted = [...trades].sort((a, b) => new Date(a.trade_time).getTime() - new Date(b.trade_time).getTime());
  
  return {
    open: sorted[0].price,
    high: Math.max(...sorted.map(t => t.price)),
    low: Math.min(...sorted.map(t => t.price)),
    close: sorted[sorted.length - 1].price,
    volume: sorted.reduce((sum, t) => sum + (t.quantity || 0), 0),
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

    console.log(`Fetching quotes: isins=${isins}, mic=${mic}`);

    // Parse ISINs with optional currency: "SE0022419784:SEK,GB0000000001:GBP"
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

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0)).toISOString();

    // If only MIC provided, fetch all ISINs for that MIC
    if (isinPairs.length === 0 && mic) {
      const { data: micData, error: micError } = await supabase
        .from("symbology")
        .select("isin, currency, name, mic")
        .eq("mic", mic)
        .not("isin", "is", null);

      if (micError) {
        console.error("Error fetching MIC data:", micError);
        return new Response(
          JSON.stringify({ quotes: [], count: 0, error: micError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (micData && micData.length > 0) {
        // Build a list of unique ISIN-currency pairs with their MICs
        const isinMicMap = new Map<string, { mic: string; currency: string; name: string }>();
        for (const sym of micData) {
          if (sym.isin) {
            isinMicMap.set(`${sym.isin}:${sym.currency}`, { mic: sym.mic, currency: sym.currency, name: sym.name });
          }
        }

        const uniqueIsins = [...new Set(micData.map(r => r.isin).filter(Boolean))];
        
        // Query trades filtered by the MIC venue
        const { data: tradesData, error: tradesError } = await supabase
          .from("trades_normalized")
          .select("symbol, price, quantity, trade_time, venue")
          .in("symbol", uniqueIsins)
          .eq("venue", mic)
          .gte("trade_time", startOfDay)
          .order("trade_time", { ascending: true });

        if (tradesError) {
          console.error("Error fetching trades:", tradesError);
          return new Response(
            JSON.stringify({ quotes: [], count: 0, error: tradesError.message }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
        }

        // Group trades by symbol
        const tradesByIsin = new Map<string, any[]>();
        for (const trade of (tradesData || [])) {
          const existing = tradesByIsin.get(trade.symbol) || [];
          existing.push(trade);
          tradesByIsin.set(trade.symbol, existing);
        }

        // Build quotes
        const quotes: QuoteResult[] = [];
        for (const sym of micData) {
          if (!sym.isin) continue;
          const trades = tradesByIsin.get(sym.isin);
          const agg = aggregateTrades(trades);
          if (!agg) continue;

          quotes.push({
            isin: sym.isin,
            currency: sym.currency || "",
            symbol: sym.isin,
            mic: sym.mic,
            name: sym.name,
            last: agg.close,
            high: agg.high,
            low: agg.low,
            open: agg.open,
            volume: agg.volume,
            timestamp: agg.timestamp,
          });
        }

        console.log(`Returning ${quotes.length} quotes for MIC ${mic}`);

        return new Response(
          JSON.stringify({ quotes, count: quotes.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: "No ISINs found for MIC" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isinPairs.length === 0) {
      return new Response(
        JSON.stringify({ quotes: [], count: 0, error: "No ISINs provided or found for MIC" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${isinPairs.length} ISIN/currency pairs`);

    const quotes: QuoteResult[] = [];

    // For each ISIN+currency pair, look up the correct MIC and filter trades by venue
    for (const pair of isinPairs) {
      // Look up symbology to get MIC for this ISIN+currency
      let symQuery = supabase
        .from("symbology")
        .select("isin, name, currency, mic")
        .eq("isin", pair.isin);
      
      if (pair.currency) {
        symQuery = symQuery.eq("currency", pair.currency);
      }
      
      const { data: symData } = await symQuery.limit(1).maybeSingle();
      
      if (!symData) {
        console.log(`No symbology found for ISIN ${pair.isin}:${pair.currency}`);
        continue;
      }

      const targetMic = symData.mic;
      console.log(`ISIN ${pair.isin}:${pair.currency} -> MIC ${targetMic}`);

      // Query trades filtered by venue (MIC)
      let tradesQuery = supabase
        .from("trades_normalized")
        .select("symbol, price, quantity, trade_time, venue")
        .eq("symbol", pair.isin)
        .gte("trade_time", startOfDay)
        .order("trade_time", { ascending: true });

      if (targetMic) {
        tradesQuery = tradesQuery.eq("venue", targetMic);
      }

      const { data: tradesData } = await tradesQuery;
      
      const agg = aggregateTrades(tradesData || undefined);
      if (!agg) {
        console.log(`No trade data for ${pair.isin} at MIC ${targetMic}`);
        continue;
      }

      quotes.push({
        isin: pair.isin,
        currency: symData.currency || pair.currency || "",
        symbol: pair.isin,
        mic: symData.mic,
        name: symData.name,
        last: agg.close,
        high: agg.high,
        low: agg.low,
        open: agg.open,
        volume: agg.volume,
        timestamp: agg.timestamp,
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

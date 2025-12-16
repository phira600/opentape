import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface Symbol {
  id: string;
  symbol: string;
  isin: string | null;
  name: string | null;
  venue: string;
  currency: string | null;
  source: string;
  mic: string | null;
  segment: string | null;
  tick_table: string | null;
  raw_data: Json | null;
}

async function fetchAllSymbols(): Promise<Symbol[]> {
  const allSymbols: Symbol[] = [];
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  
  while (hasMore) {
    const { data, error } = await supabase
      .from("symbology")
      .select("id, symbol, isin, name, venue, currency, source, mic, segment, tick_table, raw_data")
      .order("symbol", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error || !data || data.length === 0) {
      hasMore = false;
    } else {
      allSymbols.push(...data);
      hasMore = data.length === pageSize;
      page++;
    }
  }
  
  return allSymbols;
}

export function useSymbology() {
  const { data: symbols = [], isLoading, refetch } = useQuery({
    queryKey: ['symbology'],
    queryFn: fetchAllSymbols,
    staleTime: 5 * 60 * 1000, // 5 minutes - symbology rarely changes
    gcTime: 30 * 60 * 1000,   // 30 minutes cache retention
  });

  const uniqueSymbolNames = [...new Set(symbols.map((s) => s.symbol))].sort();
  const venues = [...new Set(symbols.map((s) => s.mic).filter(Boolean))].sort() as string[];

  return { symbols, uniqueSymbolNames, venues, isLoading, refetch };
}
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Symbol {
  id: string;
  symbol: string;
  isin: string | null;
  name: string | null;
  venue: string;
  currency: string | null;
  source: string;
  mic: string | null;
  segment: string | null;
}

export function useSymbology() {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [uniqueSymbolNames, setUniqueSymbolNames] = useState<string[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSymbology = async () => {
    setIsLoading(true);
    
    // Fetch all symbols using pagination (Supabase default limit is 1000)
    const allSymbols: Symbol[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from("symbology")
        .select("id, symbol, isin, name, venue, currency, source, mic, segment")
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
    
    setSymbols(allSymbols);
    const uniqueNames = [...new Set(allSymbols.map((s) => s.symbol))].sort();
    // Use MIC as the venue for filtering
    const uniqueVenues = [...new Set(allSymbols.map((s) => s.mic).filter(Boolean))].sort() as string[];
    setUniqueSymbolNames(uniqueNames);
    setVenues(uniqueVenues);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSymbology();
  }, []);

  return { symbols, uniqueSymbolNames, venues, isLoading, refetch: fetchSymbology };
}

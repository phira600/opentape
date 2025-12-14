import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SymbolSearchResult {
  symbol: string;
  name: string | null;
  isin: string | null;
  mic: string | null;
}

export function useSymbolSearch() {
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchSymbols = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const { data, error } = await supabase
      .from("symbology")
      .select("symbol, name, isin, mic")
      .or(`symbol.ilike.%${query}%,name.ilike.%${query}%,isin.ilike.%${query}%`)
      .limit(20);

    if (!error && data) {
      // Deduplicate by symbol
      const unique = Array.from(
        new Map(data.map((d) => [d.symbol, d])).values()
      );
      setResults(unique);
    }
    setIsSearching(false);
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  return { results, isSearching, searchSymbols, clearResults };
}

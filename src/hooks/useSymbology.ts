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
    const { data, error } = await supabase
      .from("symbology")
      .select("id, symbol, isin, name, venue, currency, source, mic, segment")
      .order("symbol", { ascending: true })
      .limit(5000);

    if (!error && data) {
      setSymbols(data);
      const uniqueNames = [...new Set(data.map((s) => s.symbol))].sort();
      const uniqueVenues = [...new Set(data.map((s) => s.venue))].sort();
      setUniqueSymbolNames(uniqueNames);
      setVenues(uniqueVenues);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSymbology();
  }, []);

  return { symbols, uniqueSymbolNames, venues, isLoading, refetch: fetchSymbology };
}

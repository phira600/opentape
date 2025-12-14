import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

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
  tick_table: string | null;
  raw_data: Json | null;
}

export function SymbolExplorer() {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Fetch venues once on mount
  useEffect(() => {
    const fetchVenues = async () => {
      const { data } = await supabase
        .from("symbology")
        .select("mic")
        .not("mic", "is", null);
      
      if (data) {
        const uniqueVenues = [...new Set(data.map((d) => d.mic).filter(Boolean))] as string[];
        setVenues(uniqueVenues.sort());
      }
    };
    fetchVenues();
  }, []);

  // Backend search with debounce
  const fetchSymbols = useCallback(async () => {
    setIsLoading(true);

    let query = supabase
      .from("symbology")
      .select("id, symbol, isin, name, venue, currency, source, mic, segment, tick_table, raw_data", { count: "exact" });

    if (symbolFilter) {
      query = query.or(`symbol.ilike.%${symbolFilter}%,name.ilike.%${symbolFilter}%,isin.ilike.%${symbolFilter}%`);
    }
    if (venueFilter !== "all") {
      query = query.eq("mic", venueFilter);
    }

    query = query
      .order("symbol", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    const { data, error, count } = await query;

    if (!error && data) {
      setSymbols(data);
      setTotalCount(count || 0);
    }
    setIsLoading(false);
  }, [symbolFilter, venueFilter, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSymbols();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchSymbols]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Symbol Reference Data</CardTitle>
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by symbol, name, or ISIN..."
                value={symbolFilter}
                onChange={(e) => {
                  setSymbolFilter(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={venueFilter}
              onValueChange={(v) => {
                setVenueFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All MICs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All MICs</SelectItem>
                {venues.map((venue) => (
                  <SelectItem key={venue} value={venue}>
                    {venue}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : symbols.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">
              No symbols found. Run the symbology fetch to populate data.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>ISIN</TableHead>
                      <TableHead>MIC</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Data Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {symbols.map((sym) => (
                      <TableRow 
                        key={sym.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedSymbol(sym)}
                      >
                        <TableCell className="font-mono font-medium">
                          {sym.symbol}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={sym.name || ""}>
                          {sym.name || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {sym.isin || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{sym.mic || "-"}</Badge>
                        </TableCell>
                        <TableCell>
                          {sym.currency || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{sym.source} {sym.venue}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages} ({totalCount} symbols)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedSymbol} onOpenChange={() => setSelectedSymbol(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono">{selectedSymbol?.symbol}</span>
              {selectedSymbol?.name && (
                <span className="text-muted-foreground font-normal text-sm">
                  {selectedSymbol.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedSymbol && (
            <div className="space-y-4">
              {selectedSymbol.raw_data && Object.keys(selectedSymbol.raw_data).length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(selectedSymbol.raw_data).map(([key, value]) => (
                    <div key={key} className={String(value).length > 30 ? "col-span-2" : ""}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">{key}</p>
                      <p className="font-mono text-sm break-all">{String(value) || "-"}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Symbol</p>
                    <p className="font-mono font-medium">{selectedSymbol.symbol}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">ISIN</p>
                    <p className="font-mono">{selectedSymbol.isin || "-"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Name</p>
                    <p>{selectedSymbol.name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">MIC</p>
                    <Badge variant="outline">{selectedSymbol.mic || "-"}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Currency</p>
                    <p>{selectedSymbol.currency || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Segment</p>
                    <p>{selectedSymbol.segment || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tick Table</p>
                    <p>{selectedSymbol.tick_table || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Data Source</p>
                    <Badge variant="secondary">{selectedSymbol.source} {selectedSymbol.venue}</Badge>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

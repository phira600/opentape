import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useSymbology } from "@/hooks/useSymbology";
import type { Json } from "@/integrations/supabase/types";

interface Trade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  trade_time: string;
  venue: string;
  market_mechanism: string | null;
  trading_mode: string | null;
  raw_data: Json | null;
}

export function TradesTable() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const pageSize = 20;
  const { venues } = useSymbology();

  const fetchTrades = async () => {
    setIsLoading(true);

    let query = supabase
      .from("trades_normalized")
      .select("id, symbol, price, quantity, trade_time, venue, market_mechanism, trading_mode, raw_data")
      .order("trade_time", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (symbolFilter) {
      query = query.ilike("symbol", `%${symbolFilter}%`);
    }
    if (venueFilter && venueFilter !== "all") {
      query = query.eq("venue", venueFilter);
    }

    const { data, error } = await query;

    if (!error && data) {
      setTrades(data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchTrades();
  }, [symbolFilter, venueFilter, page]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(price);
  };

  const formatQuantity = (quantity: number) => {
    return new Intl.NumberFormat("en-US").format(quantity);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Trade Data Explorer</CardTitle>
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by symbol..."
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
                <SelectValue placeholder="All Venues" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Venues</SelectItem>
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
          ) : trades.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">
              No trades found. Add a data source and run a fetch to see data.
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Venue</TableHead>
                      <TableHead>MMT</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow 
                        key={trade.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTrade(trade)}
                      >
                        <TableCell className="font-mono font-medium">
                          {trade.symbol}
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatPrice(trade.price)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatQuantity(trade.quantity)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{trade.venue}</Badge>
                        </TableCell>
                        <TableCell>
                          {trade.market_mechanism && (
                            <Badge variant="secondary" className="text-xs">
                              {trade.market_mechanism}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(trade.trade_time), "MMM d, HH:mm:ss")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page + 1}
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
                    disabled={trades.length < pageSize}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Raw Data Dialog */}
      <Dialog open={!!selectedTrade} onOpenChange={() => setSelectedTrade(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono">{selectedTrade?.symbol}</span>
              <Badge variant="outline">{selectedTrade?.venue}</Badge>
            </DialogTitle>
          </DialogHeader>
          {selectedTrade && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 pb-3 border-b">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Price</p>
                  <p className="font-mono font-medium">{formatPrice(selectedTrade.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Quantity</p>
                  <p className="font-mono">{formatQuantity(selectedTrade.quantity)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Time</p>
                  <p className="font-mono text-sm">{format(new Date(selectedTrade.trade_time), "MMM d, HH:mm:ss.SSS")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">MMT</p>
                  <p>{selectedTrade.market_mechanism || "-"} / {selectedTrade.trading_mode || "-"}</p>
                </div>
              </div>

              {/* Raw Data */}
              {selectedTrade.raw_data && Object.keys(selectedTrade.raw_data).length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-2">Raw Data</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selectedTrade.raw_data).map(([key, value]) => (
                      <div key={key} className={String(value).length > 25 ? "col-span-2" : ""}>
                        <p className="text-xs text-muted-foreground">{key}</p>
                        <p className="font-mono text-sm break-all">{String(value) || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No raw data available</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

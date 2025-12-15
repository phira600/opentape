import { useState, useMemo } from "react";
import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { IntradayChart } from "@/components/dashboard/IntradayChart";

export default function ApiTest() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  // Intraday state
  const [intradayIsin, setIntradayIsin] = useState("");
  const [intradayCurrency, setIntradayCurrency] = useState("");
  const [intradayInterval, setIntradayInterval] = useState("1");
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayResult, setIntradayResult] = useState<string>("");
  const [intradayData, setIntradayData] = useState<any>(null);

  // Quotes state
  const [quotesIsins, setQuotesIsins] = useState("");
  const [quotesMic, setQuotesMic] = useState("");
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesResult, setQuotesResult] = useState<string>("");

  // Query Symbology state
  const [symSymbol, setSymSymbol] = useState("");
  const [symIsin, setSymIsin] = useState("");
  const [symName, setSymName] = useState("");
  const [symVenue, setSymVenue] = useState("");
  const [symExact, setSymExact] = useState(false);
  const [symLimit, setSymLimit] = useState("10");
  const [symLoading, setSymLoading] = useState(false);
  const [symResult, setSymResult] = useState<string>("");

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const handleIntraday = async () => {
    setIntradayLoading(true);
    setIntradayResult("");
    setIntradayData(null);

    try {
      const params: Record<string, string> = {
        isin: intradayIsin,
        currency: intradayCurrency,
      };
      if (intradayInterval) params.interval = intradayInterval;

      const { data, error } = await supabase.functions.invoke("intraday", {
        body: params,
      });

      if (error) throw error;
      setIntradayResult(JSON.stringify(data, null, 2));
      setIntradayData(data);
    } catch (error) {
      setIntradayResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
      setIntradayData(null);
    }

    setIntradayLoading(false);
  };

  const handleQuotes = async () => {
    setQuotesLoading(true);
    setQuotesResult("");

    try {
      const params: Record<string, string> = {};
      if (quotesIsins) params.isins = quotesIsins;
      if (quotesMic) params.mic = quotesMic;

      const { data, error } = await supabase.functions.invoke("quotes", {
        body: params,
      });

      if (error) throw error;
      setQuotesResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setQuotesResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
    }

    setQuotesLoading(false);
  };

  const handleQuerySymbology = async () => {
    setSymLoading(true);
    setSymResult("");

    try {
      const params: Record<string, string> = {};
      if (symSymbol) params.symbol = symSymbol;
      if (symIsin) params.isin = symIsin;
      if (symName) params.name = symName;
      if (symVenue) params.venue = symVenue;
      if (symExact) params.exact = "true";
      if (symLimit) params.limit = symLimit;

      const { data, error } = await supabase.functions.invoke("query-symbology", {
        body: params,
      });

      if (error) throw error;
      setSymResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setSymResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
    }

    setSymLoading(false);
  };

  const ResultBox = ({ result, loading }: { result: string; loading: boolean }) => (
    <div className="relative">
      {result && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2"
          onClick={() => copyToClipboard(result)}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      )}
      <pre className="bg-muted p-4 rounded text-sm overflow-x-auto min-h-[100px] max-h-[400px] overflow-y-auto">
        {loading ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running...
          </span>
        ) : result ? (
          result
        ) : (
          <span className="text-muted-foreground">Response will appear here</span>
        )}
      </pre>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">API Test Console</h1>
          <p className="text-muted-foreground">
            Test the Trade Data Hub Market Data APIs interactively
          </p>
        </div>

        <Tabs defaultValue="intraday" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="intraday">Intraday</TabsTrigger>
            <TabsTrigger value="quotes">Quotes</TabsTrigger>
            <TabsTrigger value="query-symbology">Query Symbology</TabsTrigger>
          </TabsList>

          <TabsContent value="intraday">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">GET / POST</Badge>
                  <CardTitle>/intraday</CardTitle>
                </div>
                <CardDescription>
                  Get intraday OHLCV candlestick data for a symbol
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="intraday-isin">ISIN *</Label>
                    <Input
                      id="intraday-isin"
                      placeholder="e.g., GB00BH4HKS39"
                      value={intradayIsin}
                      onChange={(e) => setIntradayIsin(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="intraday-currency">Currency *</Label>
                    <Input
                      id="intraday-currency"
                      placeholder="e.g., GBP, EUR"
                      value={intradayCurrency}
                      onChange={(e) => setIntradayCurrency(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="intraday-interval">Interval (minutes)</Label>
                    <Select value={intradayInterval} onValueChange={setIntradayInterval}>
                      <SelectTrigger>
                        <SelectValue placeholder="1 minute" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 minute</SelectItem>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button onClick={handleIntraday} disabled={intradayLoading || !intradayIsin || !intradayCurrency}>
                  {intradayLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Get Intraday Data
                </Button>

                <ResultBox result={intradayResult} loading={intradayLoading} />

                <IntradayChart
                  data={intradayData?.data || []}
                  isin={intradayData?.isin}
                  currency={intradayData?.currency}
                  last={intradayData?.last}
                  lastTimestamp={intradayData?.lastTimestamp}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">GET / POST</Badge>
                  <CardTitle>/quotes</CardTitle>
                </div>
                <CardDescription>
                  Get latest quotes for symbols (last, high, low, open, volume)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="quotes-isins">ISINs (with optional :currency)</Label>
                    <Input
                      id="quotes-isins"
                      placeholder="e.g., GB00BH4HKS39:GBP,SE0022419784:SEK"
                      value={quotesIsins}
                      onChange={(e) => setQuotesIsins(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: ISIN:CURRENCY for mixed queries
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quotes-mic">MIC (query by market)</Label>
                    <Input
                      id="quotes-mic"
                      placeholder="e.g., XLON, XSTO"
                      value={quotesMic}
                      onChange={(e) => setQuotesMic(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Returns all ISINs for the given MIC
                    </p>
                  </div>
                </div>

                <Button onClick={handleQuotes} disabled={quotesLoading}>
                  {quotesLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Get Quotes
                </Button>

                <ResultBox result={quotesResult} loading={quotesLoading} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="query-symbology">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">GET / POST</Badge>
                  <CardTitle>/query-symbology</CardTitle>
                </div>
                <CardDescription>
                  Search and filter financial instrument reference data
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="sym-symbol">Symbol</Label>
                    <Input
                      id="sym-symbol"
                      placeholder="e.g., VOD, AAPL"
                      value={symSymbol}
                      onChange={(e) => setSymSymbol(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sym-isin">ISIN</Label>
                    <Input
                      id="sym-isin"
                      placeholder="e.g., GB00BH4HKS39"
                      value={symIsin}
                      onChange={(e) => setSymIsin(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sym-name">Company Name</Label>
                    <Input
                      id="sym-name"
                      placeholder="e.g., Vodafone"
                      value={symName}
                      onChange={(e) => setSymName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sym-venue">Venue</Label>
                    <Select value={symVenue || "all"} onValueChange={(v) => setSymVenue(v === "all" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="All venues" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All venues</SelectItem>
                        <SelectItem value="SIS">SIS</SelectItem>
                        <SelectItem value="BXE">BXE</SelectItem>
                        <SelectItem value="CXE">CXE</SelectItem>
                        <SelectItem value="DXE">DXE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sym-limit">Limit</Label>
                    <Input
                      id="sym-limit"
                      type="number"
                      placeholder="10"
                      value={symLimit}
                      onChange={(e) => setSymLimit(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-6">
                    <Switch
                      id="sym-exact"
                      checked={symExact}
                      onCheckedChange={setSymExact}
                    />
                    <Label htmlFor="sym-exact">Exact symbol match</Label>
                  </div>
                </div>

                <Button onClick={handleQuerySymbology} disabled={symLoading}>
                  {symLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Query
                </Button>

                <ResultBox result={symResult} loading={symLoading} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

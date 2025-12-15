import { useState } from "react";
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

export default function ApiTest() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  // Query Symbology state
  const [symSymbol, setSymSymbol] = useState("");
  const [symIsin, setSymIsin] = useState("");
  const [symName, setSymName] = useState("");
  const [symVenue, setSymVenue] = useState("");
  const [symExact, setSymExact] = useState(false);
  const [symLimit, setSymLimit] = useState("10");
  const [symLoading, setSymLoading] = useState(false);
  const [symResult, setSymResult] = useState<string>("");

  // Fetch Symbology state
  const [fetchSymForce, setFetchSymForce] = useState(false);
  const [fetchSymLoading, setFetchSymLoading] = useState(false);
  const [fetchSymResult, setFetchSymResult] = useState<string>("");

  // Fetch Trade Files state
  const [fetchJobId, setFetchJobId] = useState("");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchResult, setFetchResult] = useState<string>("");

  // Cleanup state
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string>("");

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
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

  const handleFetchSymbology = async () => {
    setFetchSymLoading(true);
    setFetchSymResult("");

    try {
      const { data, error } = await supabase.functions.invoke("fetch-symbology", {
        body: { force: fetchSymForce },
      });

      if (error) throw error;
      setFetchSymResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setFetchSymResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
    }

    setFetchSymLoading(false);
  };

  const handleFetchTradeFiles = async () => {
    setFetchLoading(true);
    setFetchResult("");

    try {
      const body: Record<string, string> = {};
      if (fetchJobId) body.job_id = fetchJobId;

      const { data, error } = await supabase.functions.invoke("fetch-trade-files", {
        body,
      });

      if (error) throw error;
      setFetchResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setFetchResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
    }

    setFetchLoading(false);
  };

  const handleCleanup = async () => {
    setCleanupLoading(true);
    setCleanupResult("");

    try {
      const { data, error } = await supabase.functions.invoke("cleanup-old-trades");

      if (error) throw error;
      setCleanupResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setCleanupResult(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }, null, 2));
    }

    setCleanupLoading(false);
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
            Test the Trade Data Hub APIs interactively
          </p>
        </div>

        <Tabs defaultValue="query-symbology" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="query-symbology">Query Symbology</TabsTrigger>
            <TabsTrigger value="fetch-symbology">Fetch Symbology</TabsTrigger>
            <TabsTrigger value="fetch-trades">Fetch Trade Files</TabsTrigger>
            <TabsTrigger value="cleanup">Cleanup</TabsTrigger>
          </TabsList>

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
                    <Select value={symVenue} onValueChange={setSymVenue}>
                      <SelectTrigger>
                        <SelectValue placeholder="All venues" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All venues</SelectItem>
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

          <TabsContent value="fetch-symbology">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">POST</Badge>
                  <CardTitle>/fetch-symbology</CardTitle>
                </div>
                <CardDescription>
                  Fetch and update symbology reference data from CBOE SIS
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="fetch-sym-force"
                    checked={fetchSymForce}
                    onCheckedChange={setFetchSymForce}
                  />
                  <Label htmlFor="fetch-sym-force">Force run (ignore market hours)</Label>
                </div>

                <Button onClick={handleFetchSymbology} disabled={fetchSymLoading}>
                  {fetchSymLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Fetch Symbology
                </Button>

                <ResultBox result={fetchSymResult} loading={fetchSymLoading} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fetch-trades">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">POST</Badge>
                  <CardTitle>/fetch-trade-files</CardTitle>
                </div>
                <CardDescription>
                  Trigger data fetching for configured data sources
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="fetch-job-id">Job ID (optional)</Label>
                  <Input
                    id="fetch-job-id"
                    placeholder="Leave empty to run all enabled jobs"
                    value={fetchJobId}
                    onChange={(e) => setFetchJobId(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    If empty, all enabled jobs will be executed
                  </p>
                </div>

                <Button onClick={handleFetchTradeFiles} disabled={fetchLoading}>
                  {fetchLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Fetch Trade Files
                </Button>

                <ResultBox result={fetchResult} loading={fetchLoading} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cleanup">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">POST</Badge>
                  <CardTitle>/cleanup-old-trades</CardTitle>
                </div>
                <CardDescription>
                  Remove trade data older than 30 days
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-muted-foreground">
                  This will delete all trade records and activity logs older than 30 days.
                </p>

                <Button onClick={handleCleanup} disabled={cleanupLoading} variant="destructive">
                  {cleanupLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Cleanup
                </Button>

                <ResultBox result={cleanupResult} loading={cleanupLoading} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

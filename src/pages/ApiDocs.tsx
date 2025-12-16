import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code } from "lucide-react";

const API_BASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

interface ApiEndpoint {
  name: string;
  path: string;
  method: string;
  description: string;
  parameters: { name: string; type: string; required: boolean; description: string }[];
  responseFields: { name: string; type: string; description: string }[];
  exampleRequest?: string;
  exampleResponse?: string;
}

const endpoints: ApiEndpoint[] = [
  {
    name: "Intraday OHLCV",
    path: "/intraday",
    method: "GET / POST",
    description: "Get intraday OHLCV (Open, High, Low, Close, Volume) candlestick data aggregated directly from trades_normalized. Requires API key authentication via x-api-key header.",
    parameters: [
      { name: "isin", type: "string", required: true, description: "ISIN code of the instrument (e.g., GB00BH4HKS39)" },
      { name: "currency", type: "string", required: true, description: "Trading currency (e.g., GBP, EUR)" },
      { name: "interval", type: "number", required: false, description: "Candle interval in minutes (default: 1)" },
      { name: "from", type: "string", required: false, description: "Start datetime in ISO format (default: 00:00 UTC of today)" },
      { name: "to", type: "string", required: false, description: "End datetime in ISO format (default: now)" },
    ],
    responseFields: [
      { name: "isin", type: "string", description: "Requested ISIN" },
      { name: "currency", type: "string", description: "Trading currency" },
      { name: "symbol", type: "string", description: "Resolved symbol code" },
      { name: "venue", type: "string", description: "Trading venue" },
      { name: "interval", type: "number", description: "Applied interval in minutes" },
      { name: "from", type: "string", description: "Start of data range" },
      { name: "to", type: "string", description: "End of data range" },
      { name: "data", type: "array", description: "Array of OHLCV candles" },
      { name: "data[].timestamp", type: "string", description: "Candle timestamp" },
      { name: "data[].open", type: "number", description: "Opening price" },
      { name: "data[].high", type: "number", description: "Highest price" },
      { name: "data[].low", type: "number", description: "Lowest price" },
      { name: "data[].close", type: "number", description: "Closing price" },
      { name: "data[].volume", type: "number", description: "Trading volume" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/intraday?isin=GB00BH4HKS39&currency=GBP&interval=5
Headers: x-api-key: your_api_key`,
    exampleResponse: `{
  "isin": "GB00BH4HKS39",
  "currency": "GBP",
  "symbol": "VOD",
  "venue": "SIS",
  "interval": 5,
  "from": "2025-12-16T00:00:00.000Z",
  "to": "2025-12-16T12:00:00.000Z",
  "data": [
    {
      "timestamp": "2025-12-16T08:00:00.000Z",
      "open": 72.50,
      "high": 72.85,
      "low": 72.45,
      "close": 72.70,
      "volume": 15000
    }
  ]
}`,
  },
  {
    name: "Quotes",
    path: "/quotes",
    method: "GET / POST",
    description: "Get latest quote data (last price, daily high/low/open, volume) aggregated directly from trades_normalized. Supports ISIN:currency pairs or MIC-based queries. Requires API key authentication via x-api-key header.",
    parameters: [
      { name: "isins", type: "string", required: false, description: "Comma-separated ISINs with optional currency suffix (e.g., 'GB00BH4HKS39:GBP,SE0022419784:SEK')" },
      { name: "mic", type: "string", required: false, description: "Query all instruments by MIC code (e.g., XLON, XSTO). Returns quotes for all ISINs at that MIC." },
    ],
    responseFields: [
      { name: "quotes", type: "array", description: "Array of quote objects" },
      { name: "quotes[].isin", type: "string", description: "ISIN code" },
      { name: "quotes[].currency", type: "string", description: "Trading currency" },
      { name: "quotes[].symbol", type: "string", description: "Symbol code" },
      { name: "quotes[].mic", type: "string", description: "Market Identifier Code" },
      { name: "quotes[].name", type: "string", description: "Company name" },
      { name: "quotes[].last", type: "number", description: "Last traded price" },
      { name: "quotes[].high", type: "number", description: "Daily high" },
      { name: "quotes[].low", type: "number", description: "Daily low" },
      { name: "quotes[].open", type: "number", description: "Opening price" },
      { name: "quotes[].volume", type: "number", description: "Daily volume" },
      { name: "quotes[].timestamp", type: "string", description: "Last trade time" },
      { name: "count", type: "number", description: "Number of quotes returned" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/quotes?isins=GB00BH4HKS39:GBP,SE0022419784:SEK
Headers: x-api-key: your_api_key`,
    exampleResponse: `{
  "quotes": [
    {
      "isin": "GB00BH4HKS39",
      "currency": "GBP",
      "symbol": "VOD",
      "mic": "XLON",
      "name": "VODAFONE GROUP PLC",
      "last": 72.50,
      "high": 72.85,
      "low": 72.30,
      "open": 72.40,
      "volume": 125000,
      "timestamp": "2025-12-16T08:45:00.000Z"
    }
  ],
  "count": 1
}`,
  },
  {
    name: "Query Symbology",
    path: "/query-symbology",
    method: "GET / POST",
    description: "Search and filter financial instrument reference data. Returns deduplicated records by ISIN with a venues array showing all venues where the instrument trades. No API key required.",
    parameters: [
      { name: "symbol", type: "string", required: false, description: "Filter by symbol (partial match, case-insensitive)" },
      { name: "exact", type: "boolean", required: false, description: "If true, match symbol exactly instead of partial match" },
      { name: "isin", type: "string", required: false, description: "Filter by ISIN (exact match)" },
      { name: "name", type: "string", required: false, description: "Filter by company name (partial match)" },
      { name: "venue", type: "string", required: false, description: "Filter by venue (e.g., SIS, BXE, DXE)" },
      { name: "source", type: "string", required: false, description: "Filter by data source (e.g., CBOE)" },
      { name: "currency", type: "string", required: false, description: "Filter by currency (e.g., EUR, GBP)" },
      { name: "limit", type: "number", required: false, description: "Maximum results to return (default: 100)" },
      { name: "offset", type: "number", required: false, description: "Offset for pagination (default: 0)" },
    ],
    responseFields: [
      { name: "success", type: "boolean", description: "Whether the request succeeded" },
      { name: "data", type: "array", description: "Array of deduplicated symbol records" },
      { name: "data[].isin", type: "string", description: "ISIN code" },
      { name: "data[].symbol", type: "string", description: "Primary symbol" },
      { name: "data[].name", type: "string", description: "Company name" },
      { name: "data[].currency", type: "string", description: "Trading currency" },
      { name: "data[].source", type: "string", description: "Data source" },
      { name: "data[].venues", type: "array", description: "Array of venues where instrument trades" },
      { name: "count", type: "number", description: "Number of records returned" },
      { name: "limit", type: "number", description: "Applied limit" },
      { name: "offset", type: "number", description: "Applied offset" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/query-symbology?symbol=VOD&limit=10`,
    exampleResponse: `{
  "success": true,
  "data": [
    {
      "isin": "GB00BH4HKS39",
      "symbol": "VOD",
      "name": "VODAFONE GROUP PLC",
      "currency": "GBP",
      "source": "CBOE",
      "mic": "XLON",
      "venues": ["SIS", "BXE", "CXE"]
    }
  ],
  "count": 1,
  "limit": 10,
  "offset": 0
}`,
  },
];

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">API Documentation</h1>
          <p className="text-muted-foreground">
            Reference documentation for the Trade Data Hub Market Data APIs
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Base URL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="bg-muted px-3 py-2 rounded text-sm block overflow-x-auto">
              {API_BASE_URL}
            </code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>All API endpoints require authentication via API key</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Include your API key in the <code className="bg-muted px-1.5 py-0.5 rounded text-sm">x-api-key</code> header with every request.
            </p>
            <div>
              <h4 className="text-sm font-medium mb-2">Example</h4>
              <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
{`curl -X GET "${API_BASE_URL}/quotes?mic=XLON" \\
  -H "x-api-key: your_api_key_here"`}
              </pre>
            </div>
            <p className="text-sm text-muted-foreground">
              Generate API keys from the Settings page in the dashboard.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.path}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="font-mono">
                    {endpoint.method}
                  </Badge>
                  <CardTitle className="text-lg font-mono">{endpoint.path}</CardTitle>
                </div>
                <CardDescription className="text-base">
                  {endpoint.name}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-muted-foreground">{endpoint.description}</p>

                <Tabs defaultValue="parameters" className="w-full">
                  <TabsList>
                    <TabsTrigger value="parameters">Parameters</TabsTrigger>
                    <TabsTrigger value="response">Response</TabsTrigger>
                    <TabsTrigger value="example">Example</TabsTrigger>
                  </TabsList>

                  <TabsContent value="parameters" className="mt-4">
                    {endpoint.parameters.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Required</TableHead>
                            <TableHead>Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {endpoint.parameters.map((param) => (
                            <TableRow key={param.name}>
                              <TableCell className="font-mono">{param.name}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{param.type}</Badge>
                              </TableCell>
                              <TableCell>
                                {param.required ? (
                                  <Badge>Required</Badge>
                                ) : (
                                  <span className="text-muted-foreground">Optional</span>
                                )}
                              </TableCell>
                              <TableCell>{param.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground">No parameters required</p>
                    )}
                  </TabsContent>

                  <TabsContent value="response" className="mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {endpoint.responseFields.map((field) => (
                          <TableRow key={field.name}>
                            <TableCell className="font-mono">{field.name}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{field.type}</Badge>
                            </TableCell>
                            <TableCell>{field.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="example" className="mt-4 space-y-4">
                    {endpoint.exampleRequest && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Request</h4>
                        <pre className="bg-muted p-4 rounded text-sm overflow-x-auto whitespace-pre-wrap">
                          {endpoint.exampleRequest}
                        </pre>
                      </div>
                    )}
                    {endpoint.exampleResponse && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Response</h4>
                        <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                          {endpoint.exampleResponse}
                        </pre>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

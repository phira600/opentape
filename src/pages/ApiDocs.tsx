import { SmartHeader } from "@/components/SmartHeader";
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
    description:
      "Get intraday OHLCV (Open, High, Low, Close, Volume) candlestick data aggregated using the interval parameter.",
    parameters: [
      { name: "isin", type: "string", required: true, description: "ISIN code of the instrument (e.g., GB00BH4HKS39)" },
      { name: "currency", type: "string", required: true, description: "Instrument currency (e.g., GBP, EUR, SEK)" },
      { name: "interval", type: "number", required: false, description: "Candle interval in minutes (default: 1)" },
      {
        name: "from",
        type: "string",
        required: false,
        description: "Start datetime in ISO format (default: 00:00 UTC of today)",
      },
      { name: "to", type: "string", required: false, description: "End datetime in ISO format (default: now)" },
    ],
    responseFields: [
      { name: "isin", type: "string", description: "Requested ISIN" },
      { name: "currency", type: "string", description: "Instrument currency" },
      { name: "name", type: "string | null", description: "Instrument name from symbology" },
      { name: "interval", type: "number", description: "Applied interval in minutes" },
      { name: "from", type: "string", description: "Start of data range" },
      { name: "to", type: "string", description: "End of data range" },
      { name: "last", type: "number | null", description: "Last closing price" },
      { name: "lastTimestamp", type: "string | null", description: "Timestamp of last candle" },
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
  "name": "VODAFONE GROUP PLC",
  "interval": 5,
  "from": "2025-12-16T00:00:00.000Z",
  "to": "2025-12-16T12:00:00.000Z",
  "last": 72.70,
  "lastTimestamp": "2025-12-16T08:00:00.000Z",
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
    description:
      "Get latest quote data (last price, daily high/low/open, volume) for ISIN:currency pairs. Requires API key authentication via x-api-key header.",
    parameters: [
      {
        name: "isins",
        type: "string",
        required: true,
        description: "Comma-separated ISINs with optional currency suffix (e.g., 'GB00BH4HKS39:GBP,SE0022419784:SEK'). If currency is omitted, it will be looked up from symbology.",
      },
    ],
    responseFields: [
      { name: "quotes", type: "array", description: "Array of quote objects" },
      { name: "quotes[].isin", type: "string", description: "ISIN code" },
      { name: "quotes[].currency", type: "string", description: "Trading currency" },
      { name: "quotes[].name", type: "string | null", description: "Company name" },
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
    description:
      "Search and filter financial instrument reference data. Returns deduplicated records by ISIN with a venues array showing all venues where the instrument trades. Requires API key authentication via x-api-key header.",
    parameters: [
      {
        name: "symbol",
        type: "string",
        required: false,
        description: "Filter by symbol (partial match, case-insensitive)",
      },
      {
        name: "exact",
        type: "boolean",
        required: false,
        description: "If true, match symbol exactly instead of partial match",
      },
      { name: "isin", type: "string", required: false, description: "Filter by ISIN (exact match)" },
      { name: "name", type: "string", required: false, description: "Filter by company name (partial match)" },
      { name: "mic", type: "string", required: false, description: "Filter by Market Identifier Code (e.g., XLON, XSTO, XPAR)" },
      { name: "source", type: "string", required: false, description: "Filter by data source (e.g., CBOE)" },
      { name: "currency", type: "string", required: false, description: "Filter by currency (e.g., EUR, GBP, SEK)" },
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
      { name: "data[].mic", type: "string", description: "Market Identifier Code" },
      { name: "data[].segment", type: "string", description: "Market segment" },
      { name: "data[].tick_table", type: "string", description: "Tick table identifier" },
      { name: "data[].venues", type: "array", description: "Array of venues where instrument trades" },
      { name: "count", type: "number", description: "Number of records returned" },
      { name: "limit", type: "number", description: "Applied limit" },
      { name: "offset", type: "number", description: "Applied offset" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/query-symbology?symbol=VOD&limit=10
Headers: x-api-key: your_api_key`,
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
      "segment": "MAIN",
      "tick_table": "TICK_1",
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
      <SmartHeader />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">API Documentation</h1>
          <p className="text-muted-foreground">Reference documentation for the opentape Market Data APIs</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Base URL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="bg-muted px-3 py-2 rounded text-sm block overflow-x-auto">{API_BASE_URL}</code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>All API endpoints require authentication via API key</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Include your API key in the <code className="bg-muted px-1.5 py-0.5 rounded text-sm">x-api-key</code>{" "}
              header with every request.
            </p>
            <div>
              <h4 className="text-sm font-medium mb-2">Example</h4>
              <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                {`curl -X GET "${API_BASE_URL}/quotes?isins=GB00BH4HKS39:GBP" \\
  -H "x-api-key: your_api_key_here"`}
              </pre>
            </div>
            <p className="text-sm text-muted-foreground">Generate API keys from the Settings page in the dashboard.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>IP Whitelisting</CardTitle>
            <CardDescription>Optionally restrict API access to specific IP addresses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              You can configure IP whitelisting for each API key from the Settings page. When IP addresses are added to a key's whitelist, 
              only requests from those IPs will be allowed.
            </p>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">How it works:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>If no IPs are configured for an API key, requests from <strong>any IP</strong> are allowed</li>
                <li>If one or more IPs are whitelisted, <strong>only</strong> those IPs can use the API key</li>
                <li>Requests from non-whitelisted IPs will receive a <code className="bg-muted px-1.5 py-0.5 rounded">403 Forbidden</code> error</li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Error Response</h4>
              <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                {`{
  "error": "IP address not allowed"
}`}
              </pre>
            </div>
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
                <CardDescription className="text-base">{endpoint.name}</CardDescription>
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
                        <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">{endpoint.exampleResponse}</pre>
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

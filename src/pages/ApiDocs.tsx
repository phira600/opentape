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
    description: "Get intraday OHLCV (Open, High, Low, Close, Volume) candlestick data for a symbol identified by ISIN and currency. Similar to EODHD/FMP intraday APIs.",
    parameters: [
      { name: "isin", type: "string", required: true, description: "ISIN code of the instrument (e.g., GB00BH4HKS39)" },
      { name: "currency", type: "string", required: true, description: "Trading currency (e.g., GBP, EUR)" },
      { name: "interval", type: "number", required: false, description: "Candle interval in minutes (default: 1)" },
      { name: "from", type: "string", required: false, description: "Start datetime in ISO format (default: 24h ago)" },
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
    exampleRequest: `GET ${API_BASE_URL}/intraday?isin=GB00BH4HKS39&currency=GBP&interval=5`,
    exampleResponse: `{
  "isin": "GB00BH4HKS39",
  "currency": "GBP",
  "symbol": "VOD",
  "venue": "SIS",
  "interval": 5,
  "from": "2025-12-14T09:00:00Z",
  "to": "2025-12-15T09:00:00Z",
  "data": [
    {
      "timestamp": "2025-12-15T08:00:00Z",
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
    description: "Get latest quote data (last price, daily high/low/open, volume) for one or more symbols. Filter by ISIN list, currency, or venue.",
    parameters: [
      { name: "isins", type: "string", required: false, description: "Comma-separated list of ISINs (e.g., GB00BH4HKS39,DE000BAY0017)" },
      { name: "currency", type: "string", required: false, description: "Filter by currency (e.g., GBP, EUR)" },
      { name: "venue", type: "string", required: false, description: "Filter by venue (e.g., SIS, BXE)" },
    ],
    responseFields: [
      { name: "quotes", type: "array", description: "Array of quote objects" },
      { name: "quotes[].isin", type: "string", description: "ISIN code" },
      { name: "quotes[].currency", type: "string", description: "Trading currency" },
      { name: "quotes[].symbol", type: "string", description: "Symbol code" },
      { name: "quotes[].venue", type: "string", description: "Trading venue" },
      { name: "quotes[].name", type: "string", description: "Company name" },
      { name: "quotes[].last", type: "number", description: "Last traded price" },
      { name: "quotes[].high", type: "number", description: "Daily high" },
      { name: "quotes[].low", type: "number", description: "Daily low" },
      { name: "quotes[].open", type: "number", description: "Opening price" },
      { name: "quotes[].volume", type: "number", description: "Daily volume" },
      { name: "quotes[].timestamp", type: "string", description: "Last update time" },
      { name: "count", type: "number", description: "Number of quotes returned" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/quotes?isins=GB00BH4HKS39,DE000BAY0017&currency=EUR`,
    exampleResponse: `{
  "quotes": [
    {
      "isin": "GB00BH4HKS39",
      "currency": "EUR",
      "symbol": "VOD",
      "venue": "BXE",
      "name": "VODAFONE GROUP PLC",
      "last": 0.8520,
      "high": 0.8550,
      "low": 0.8480,
      "open": 0.8500,
      "volume": 125000,
      "timestamp": "2025-12-15T08:45:00Z"
    }
  ],
  "count": 1
}`,
  },
  {
    name: "Query Symbology",
    path: "/query-symbology",
    method: "GET / POST",
    description: "Search and filter financial instrument reference data (symbology). Supports filtering by symbol, ISIN, name, venue, source, and currency.",
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
      { name: "data", type: "array", description: "Array of symbol records" },
      { name: "count", type: "number", description: "Number of records returned" },
      { name: "limit", type: "number", description: "Applied limit" },
      { name: "offset", type: "number", description: "Applied offset" },
    ],
    exampleRequest: `GET ${API_BASE_URL}/query-symbology?symbol=VOD&venue=SIS&limit=10`,
    exampleResponse: `{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "symbol": "VOD",
      "isin": "GB00BH4HKS39",
      "name": "VODAFONE GROUP PLC",
      "currency": "GBP",
      "venue": "SIS",
      "source": "CBOE",
      "mic": "XLON",
      "segment": null,
      "tick_table": "T1"
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

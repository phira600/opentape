import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code, Database, RefreshCw, Search } from "lucide-react";

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
      "tick_table": "T1",
      "raw_data": {...}
    }
  ],
  "count": 1,
  "limit": 10,
  "offset": 0
}`,
  },
  {
    name: "Fetch Trade Files",
    path: "/fetch-trade-files",
    method: "POST",
    description: "Trigger data fetching for configured data sources. Can run all enabled jobs or a specific job by ID.",
    parameters: [
      { name: "job_id", type: "string", required: false, description: "Specific job ID to run. If omitted, runs all enabled jobs." },
    ],
    responseFields: [
      { name: "success", type: "boolean", description: "Whether the operation completed" },
      { name: "results", type: "array", description: "Array of results per job" },
      { name: "results[].job_id", type: "string", description: "Job ID that was processed" },
      { name: "results[].status", type: "string", description: "Status: success, error, or skipped" },
      { name: "results[].files_count", type: "number", description: "Number of files processed" },
      { name: "results[].trades_count", type: "number", description: "Number of trades inserted" },
    ],
    exampleRequest: `POST ${API_BASE_URL}/fetch-trade-files
Content-Type: application/json

{ "job_id": "uuid-of-job" }`,
    exampleResponse: `{
  "success": true,
  "results": [
    {
      "job_id": "uuid",
      "status": "success",
      "files_count": 5,
      "trades_count": 2500
    }
  ]
}`,
  },
  {
    name: "Fetch Symbology",
    path: "/fetch-symbology",
    method: "POST",
    description: "Fetch and update symbology reference data from CBOE SIS (Systematic Internaliser Service). Updates the symbology table with latest instrument data.",
    parameters: [
      { name: "force", type: "boolean", required: false, description: "If true, run even outside market hours" },
    ],
    responseFields: [
      { name: "success", type: "boolean", description: "Whether the operation succeeded" },
      { name: "venue", type: "string", description: "Venue that was updated (SIS)" },
      { name: "count", type: "number", description: "Number of symbols upserted" },
      { name: "errors", type: "number", description: "Number of batch errors" },
      { name: "skipped", type: "boolean", description: "True if skipped due to market hours" },
      { name: "reason", type: "string", description: "Reason for skipping (if applicable)" },
    ],
    exampleRequest: `POST ${API_BASE_URL}/fetch-symbology
Content-Type: application/json

{ "force": true }`,
    exampleResponse: `{
  "success": true,
  "venue": "SIS",
  "count": 15420,
  "errors": 0
}`,
  },
  {
    name: "Cleanup Old Trades",
    path: "/cleanup-old-trades",
    method: "POST",
    description: "Remove trade data older than 30 days to manage database size. Also cleans up old activity logs.",
    parameters: [],
    responseFields: [
      { name: "success", type: "boolean", description: "Whether the cleanup succeeded" },
      { name: "deleted_count", type: "number", description: "Number of trade records deleted" },
    ],
    exampleRequest: `POST ${API_BASE_URL}/cleanup-old-trades`,
    exampleResponse: `{
  "success": true,
  "deleted_count": 50000
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
            Reference documentation for the Trade Data Hub APIs
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

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { formatDistanceToNow, format } from "date-fns";
import { RefreshCw, RotateCcw, Save, FileText, CheckCircle2, AlertTriangle, AlertCircle, Info, ChevronRight, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CronJobConfig {
  id: string;
  name: string;
  description: string | null;
  schedule: string;
  is_enabled: boolean;
  last_status: string | null;
  last_error: string | null;
  last_run_at: string | null;
  retention_days: number | null;
}

interface ActivityLogEntry {
  id: string;
  job_id: string | null;
  log_type: string;
  message: string;
  details: unknown;
  created_at: string;
}

// Map cron job IDs to keywords for log searching
const CRON_JOB_LOG_KEYWORDS: Record<string, string[]> = {
  "cleanup-old-trades": ["cleanup", "trades", "deleted"],
  "cleanup-old-candles": ["cleanup", "candles", "deleted"],
  "recreate-candles": ["candle", "backfill", "recreate"],
  "fetch-symbology": ["symbology", "symbol"],
  "provision-cron-jobs": ["cron", "provision"],
};

export function CronJobsTable() {
  const [jobs, setJobs] = useState<CronJobConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resettingJob, setResettingJob] = useState<string | null>(null);
  const [editingRetention, setEditingRetention] = useState<string | null>(null);
  const [retentionValue, setRetentionValue] = useState<string>("");
  const [savingRetention, setSavingRetention] = useState<string | null>(null);
  
  // Logs drawer state
  const [selectedJobForLogs, setSelectedJobForLogs] = useState<CronJobConfig | null>(null);
  const [jobLogs, setJobLogs] = useState<ActivityLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const fetchJobs = async () => {
    const { data, error } = await supabase
      .from("cron_job_configurations")
      .select("*")
      .order("name", { ascending: true });

    if (!error && data) {
      setJobs(data);
    }
    setIsLoading(false);
  };

  const fetchJobLogs = useCallback(async (job: CronJobConfig) => {
    setSelectedJobForLogs(job);
    setIsLoadingLogs(true);
    
    // Get keywords for this job
    const keywords = CRON_JOB_LOG_KEYWORDS[job.id] || [job.name.toLowerCase()];
    
    // Build OR conditions for message matching
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .is("job_id", null) // Cron jobs don't have a job_id
      .order("created_at", { ascending: false })
      .limit(200);
    
    // Filter logs that match any keyword
    const filteredLogs = (data || []).filter((log: ActivityLogEntry) => {
      const messageLower = log.message.toLowerCase();
      return keywords.some(kw => messageLower.includes(kw.toLowerCase()));
    }).slice(0, 100);
    
    setJobLogs(filteredLogs);
    setIsLoadingLogs(false);
  }, []);

  useEffect(() => {
    fetchJobs();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("cron_job_updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cron_job_configurations" },
        () => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const resetJobStatus = async (jobId: string) => {
    setResettingJob(jobId);
    try {
      const { error } = await supabase
        .from("cron_job_configurations")
        .update({ 
          last_status: "idle", 
          last_error: null 
        })
        .eq("id", jobId);

      if (error) throw error;
      toast.success("Job status reset to idle");
      fetchJobs();
    } catch (err) {
      toast.error("Failed to reset job status");
    } finally {
      setResettingJob(null);
    }
  };

  const startEditingRetention = (job: CronJobConfig) => {
    setEditingRetention(job.id);
    setRetentionValue(job.retention_days?.toString() || "30");
  };

  const cancelEditingRetention = () => {
    setEditingRetention(null);
    setRetentionValue("");
  };

  const saveRetentionDays = async (jobId: string) => {
    const days = parseInt(retentionValue, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      toast.error("Retention days must be between 1 and 365");
      return;
    }

    setSavingRetention(jobId);
    try {
      const { error } = await supabase
        .from("cron_job_configurations")
        .update({ retention_days: days })
        .eq("id", jobId);

      if (error) throw error;
      toast.success(`Retention updated to ${days} days`);
      setEditingRetention(null);
      setRetentionValue("");
      fetchJobs();
    } catch (err) {
      toast.error("Failed to update retention days");
    } finally {
      setSavingRetention(null);
    }
  };

  const getStatusBadgeVariant = (status: string | null) => {
    switch (status) {
      case "success":
        return "default" as const;
      case "running":
        return "secondary" as const;
      case "failed":
        return "destructive" as const;
      case "queued":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  const getLogIcon = (logType: string) => {
    switch (logType) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogBadgeVariant = (logType: string) => {
    switch (logType) {
      case "success":
        return "default";
      case "error":
        return "destructive";
      case "warning":
        return "secondary";
      default:
        return "outline";
    }
  };

  const formatLogMessage = (log: ActivityLogEntry): { title: string; details: string[]; error?: string } => {
    const details: string[] = [];
    let error: string | undefined;
    
    // Parse common patterns and make them more readable
    let title = log.message;
    
    // Parse details object for common fields
    if (log.details && typeof log.details === "object" && log.details !== null) {
      const d = log.details as Record<string, unknown>;
      
      // Extract error message if present
      if (d.error && typeof d.error === "string") {
        error = d.error;
      }
      
      if (d.count !== undefined) {
        details.push(`${Number(d.count).toLocaleString()} items processed`);
      }
      if (d.deleted_count !== undefined) {
        details.push(`${Number(d.deleted_count).toLocaleString()} deleted`);
      }
      if (d.remaining_count !== undefined && Number(d.remaining_count) > 0) {
        details.push(`${Number(d.remaining_count).toLocaleString()} remaining`);
      }
      if (d.candle_count !== undefined) {
        details.push(`${Number(d.candle_count).toLocaleString()} candles`);
      }
      if (d.trade_count !== undefined) {
        details.push(`${Number(d.trade_count).toLocaleString()} trades`);
      }
      if (d.duration_ms !== undefined) {
        const secs = Math.round(Number(d.duration_ms) / 1000);
        details.push(`${secs}s duration`);
      }
      if (d.elapsed_ms !== undefined) {
        const secs = Math.round(Number(d.elapsed_ms) / 1000);
        details.push(`${secs}s elapsed`);
      }
      if (d.from_date && d.to_date) {
        details.push(`${d.from_date} → ${d.to_date}`);
      }
      if (d.source) {
        details.push(`Source: ${d.source}`);
      }
      if (d.venue) {
        details.push(`Venue: ${d.venue}`);
      }
      if (d.errors !== undefined && Number(d.errors) > 0) {
        details.push(`${d.errors} errors`);
      }
    }
    
    return { title, details, error };
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Cron Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Cron Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {jobs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No cron jobs configured.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Retention</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{job.name}</span>
                          {job.description && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {job.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {job.schedule}
                        </code>
                      </TableCell>
                      <TableCell>
                        {job.retention_days !== null ? (
                          editingRetention === job.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={1}
                                max={365}
                                value={retentionValue}
                                onChange={(e) => setRetentionValue(e.target.value)}
                                className="w-16 h-7 text-xs"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveRetentionDays(job.id);
                                  if (e.key === "Escape") cancelEditingRetention();
                                }}
                                autoFocus
                              />
                              <span className="text-xs text-muted-foreground">days</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => saveRetentionDays(job.id)}
                                disabled={savingRetention === job.id}
                              >
                                <Save className={`h-3 w-3 ${savingRetention === job.id ? "animate-spin" : ""}`} />
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEditingRetention(job)}
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                            >
                              {job.retention_days} days
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={getStatusBadgeVariant(job.last_status)}
                            className={job.last_status === "running" ? "animate-pulse" : ""}
                          >
                            {job.last_status || "idle"}
                          </Badge>
                          {!job.is_enabled && (
                            <Badge variant="outline" className="text-yellow-600">
                              disabled
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {job.last_run_at
                          ? formatDistanceToNow(new Date(job.last_run_at), { addSuffix: true })
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        {job.last_error && (
                          <span 
                            className="text-xs text-destructive truncate block max-w-[200px]" 
                            title={job.last_error}
                          >
                            {job.last_error}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => fetchJobLogs(job)}
                            title="View logs"
                            className="h-8 w-8 p-0"
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          {(job.last_status === "running" || job.last_status === "failed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resetJobStatus(job.id)}
                              disabled={resettingJob === job.id}
                              title="Reset to idle"
                              className="h-8 w-8 p-0"
                            >
                              <RotateCcw className={`h-4 w-4 ${resettingJob === job.id ? "animate-spin" : ""}`} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Logs Drawer - Resizable */}
      <Sheet 
        open={!!selectedJobForLogs} 
        onOpenChange={(open) => !open && setSelectedJobForLogs(null)}
      >
        <SheetContent 
          className="w-[700px] sm:w-[800px] sm:max-w-[90vw] p-0 flex flex-col"
          style={{ maxWidth: "90vw" }}
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              {selectedJobForLogs?.name}
            </SheetTitle>
            <SheetDescription>
              Recent activity logs for this cron job
            </SheetDescription>
            {selectedJobForLogs?.last_error && (
              <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive font-medium flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{selectedJobForLogs.last_error}</span>
                </p>
              </div>
            )}
          </SheetHeader>
          
          <div className="flex-1 overflow-hidden">
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel defaultSize={100} minSize={30}>
                <ScrollArea className="h-full">
                  {isLoadingLogs ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : jobLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                      <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">
                        No logs found for this job.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Logs will appear after the job runs.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {jobLogs.map((log) => {
                        const { title, details, error } = formatLogMessage(log);
                        return (
                          <div 
                            key={log.id} 
                            className="px-6 py-4 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5">
                                {getLogIcon(log.log_type)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge 
                                    variant={getLogBadgeVariant(log.log_type) as "default" | "destructive" | "outline" | "secondary"}
                                    className={`text-xs ${log.log_type === "success" ? "bg-green-500" : ""}`}
                                  >
                                    {log.log_type}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                                    <span className="text-muted-foreground/60">
                                      ({formatDistanceToNow(new Date(log.created_at), { addSuffix: true })})
                                    </span>
                                  </span>
                                </div>
                                <p className="text-sm font-medium">{title}</p>
                                {error && (
                                  <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                                    <p className="text-sm text-destructive font-medium flex items-start gap-2">
                                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                      <span className="break-words">{error}</span>
                                    </p>
                                  </div>
                                )}
                                {details.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {details.map((detail, idx) => (
                                      <span 
                                        key={idx}
                                        className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-md"
                                      >
                                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                        {detail}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

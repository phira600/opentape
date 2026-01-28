import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2, Calendar, Settings, CalendarIcon, Info, FileText, Copy, ExternalLink, AlertTriangle, ChevronRight, FileX, FileWarning, BarChart3, MinusCircle } from "lucide-react";
import { formatDistanceToNow, addSeconds, format, subDays, startOfDay } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActivityLogEntry {
  id: string;
  job_id: string | null;
  log_type: string;
  message: string;
  details: unknown;
  created_at: string;
}

const DAYS_OF_WEEK = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

interface JobResultDetails {
  files_found?: number;
  files_processed?: number;
  files_empty?: number;
  trades_parsed?: number;
  trades_filtered?: number;
  trades_saved?: number;
}

interface JobConfiguration {
  id: string;
  name: string;
  source_url: string;
  source_type: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  fetch_interval_seconds?: number;
  run_days?: string[];
  run_start_hour?: number;
  run_end_hour?: number;
  timezone?: string;
  next_run_at?: string | null;
  last_result_details?: JobResultDetails | Record<string, unknown> | null;
}

// Supported timezones for scheduling
const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "Europe/Stockholm", label: "Sweden (Stockholm)" },
  { value: "Europe/Berlin", label: "Germany (Berlin)" },
  { value: "Europe/Paris", label: "France (Paris)" },
  { value: "America/New_York", label: "US Eastern" },
];

interface DataSourceTableProps {
  jobs: JobConfiguration[];
  onUpdate: () => void;
  showCronJobs?: boolean;
}

interface CronJobConfiguration {
  id: string;
  name: string;
  description: string | null;
  schedule: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  retention_days?: number | null;
}

// Map cron job IDs to keywords for log searching
const CRON_JOB_LOG_KEYWORDS: Record<string, string[]> = {
  "cleanup-old-trades": ["trades older than", "trades deleted"],
  "cleanup-old-candles": ["candles older than", "candles deleted"],
  "cleanup-old-activity-logs": ["activity logs older than", "activity logs deleted"],
  "cleanup-old-processed-files": ["processed files older than", "processed files deleted"],
  "recreate-candles": ["backfill", "recreate"],
  "fetch-symbology": ["symbology"],
  "provision-cron-jobs": ["cron", "provision"],
};

export function DataSourceTable({ jobs, onUpdate, showCronJobs = true }: DataSourceTableProps) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningCronId, setRunningCronId] = useState<string | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJobConfiguration[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editingJobSchedule, setEditingJobSchedule] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [candleFromDate, setCandleFromDate] = useState<Date | undefined>(subDays(startOfDay(new Date()), 7));
  const [candleToDate, setCandleToDate] = useState<Date | undefined>(subDays(startOfDay(new Date()), 1));
  const [jobScheduleConfig, setJobScheduleConfig] = useState<{
    run_days: string[];
    run_start_hour: number;
    run_end_hour: number;
    timezone: string;
    fetch_interval_minutes: number;
  }>({
    run_days: ["mon", "tue", "wed", "thu", "fri"],
    run_start_hour: 8,
    run_end_hour: 17,
    timezone: "Europe/London",
    fetch_interval_minutes: 5,
  });
  
  // Job logs drawer state
  const [selectedJobForLogs, setSelectedJobForLogs] = useState<JobConfiguration | null>(null);
  const [jobLogs, setJobLogs] = useState<ActivityLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Cron job logs drawer state
  const [selectedCronJobForLogs, setSelectedCronJobForLogs] = useState<CronJobConfiguration | null>(null);
  const [cronJobLogs, setCronJobLogs] = useState<ActivityLogEntry[]>([]);
  const [isLoadingCronLogs, setIsLoadingCronLogs] = useState(false);

  const fetchJobLogs = async (job: JobConfiguration) => {
    setSelectedJobForLogs(job);
    setIsLoadingLogs(true);
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(100);
    
    setJobLogs(data || []);
    setIsLoadingLogs(false);
  };

  const fetchCronJobLogs = async (cronJob: CronJobConfiguration) => {
    setSelectedCronJobForLogs(cronJob);
    setIsLoadingCronLogs(true);
    
    const keywords = CRON_JOB_LOG_KEYWORDS[cronJob.id] || [cronJob.name.toLowerCase()];
    
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .is("job_id", null) // Cron jobs don't have a job_id
      .order("created_at", { ascending: false })
      .limit(200);
    
    const filteredLogs = (data || []).filter((log: ActivityLogEntry) => {
      const messageLower = log.message.toLowerCase();
      return keywords.some(kw => messageLower.includes(kw.toLowerCase()));
    }).slice(0, 100);
    
    setCronJobLogs(filteredLogs);
    setIsLoadingCronLogs(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "URL copied to clipboard",
    });
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

  const formatLogMessage = (log: ActivityLogEntry): { title: string; details: string[]; error?: string } => {
    const details: string[] = [];
    let title = log.message;
    let error: string | undefined;
    
    if (log.details && typeof log.details === "object" && log.details !== null) {
      const d = log.details as Record<string, unknown>;
      
      // Extract error message if present
      if (d.error && typeof d.error === "string") {
        error = d.error;
      }
      
      if (d.files_processed !== undefined) {
        details.push(`${Number(d.files_processed).toLocaleString()} files processed`);
      }
      if (d.trades_count !== undefined) {
        details.push(`${Number(d.trades_count).toLocaleString()} trades`);
      }
      if (d.new_trades !== undefined) {
        details.push(`${Number(d.new_trades).toLocaleString()} new trades`);
      }
      if (d.skipped_files !== undefined && Number(d.skipped_files) > 0) {
        details.push(`${Number(d.skipped_files)} skipped`);
      }
      if (d.deleted_count !== undefined) {
        details.push(`${Number(d.deleted_count).toLocaleString()} deleted`);
      }
      if (d.remaining_count !== undefined && Number(d.remaining_count) > 0) {
        details.push(`${Number(d.remaining_count).toLocaleString()} remaining`);
      }
      if (d.count !== undefined) {
        details.push(`${Number(d.count).toLocaleString()} items processed`);
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
      if (d.source_type) {
        details.push(`Type: ${d.source_type}`);
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

  useEffect(() => {
    if (showCronJobs) {
      fetchCronJobs();
    }
  }, [showCronJobs]);

  const fetchCronJobs = async () => {
    const { data, error } = await supabase
      .from("cron_job_configurations")
      .select("*")
      .neq("id", "refresh-candles") // Hide refresh-candles - it runs automatically after downloads
      .order("name");
    
    if (!error && data) {
      setCronJobs(data);
    }
  };

  const handleCronToggle = async (cronJob: CronJobConfiguration, enabled: boolean) => {
    setTogglingId(cronJob.id);
    const { error } = await supabase
      .from("cron_job_configurations")
      .update({ is_enabled: enabled })
      .eq("id", cronJob.id);

    if (error) {
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: enabled ? "Job enabled" : "Job disabled",
        description: `${cronJob.name} is now ${enabled ? "active" : "inactive"}.`,
      });
      fetchCronJobs();
    }
    setTogglingId(null);
  };

  const handleScheduleUpdate = async (cronJob: CronJobConfiguration) => {
    const updateData: { schedule: string; retention_days?: number } = { schedule: scheduleValue };
    
    // Include retention_days for cleanup jobs
    if (cronJob.id === "cleanup-old-trades" || 
        cronJob.id === "cleanup-old-candles" ||
        cronJob.id === "cleanup-old-activity-logs" ||
        cronJob.id === "cleanup-old-processed-files") {
      updateData.retention_days = retentionDays;
    }

    const { error } = await supabase
      .from("cron_job_configurations")
      .update(updateData)
      .eq("id", cronJob.id);

    if (error) {
      toast({
        title: "Failed to update schedule",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Schedule updated",
        description: `${cronJob.name} configuration saved`,
      });
      fetchCronJobs();
    }
    setEditingSchedule(null);
  };

  const handleJobScheduleUpdate = async (job: JobConfiguration) => {
    const { error } = await supabase
      .from("job_configurations")
      .update({
        run_days: jobScheduleConfig.run_days,
        run_start_hour: jobScheduleConfig.run_start_hour,
        run_end_hour: jobScheduleConfig.run_end_hour,
        timezone: jobScheduleConfig.timezone,
        fetch_interval_seconds: jobScheduleConfig.fetch_interval_minutes * 60,
      })
      .eq("id", job.id);

    if (error) {
      toast({
        title: "Failed to update schedule",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Schedule updated",
        description: `${job.name} schedule saved`,
      });
      onUpdate();
    }
    setEditingJobSchedule(null);
  };

  const handleToggle = async (job: JobConfiguration, enabled: boolean) => {
    setTogglingId(job.id);
    const { error } = await supabase
      .from("job_configurations")
      .update({ is_enabled: enabled })
      .eq("id", job.id);

    if (error) {
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: enabled ? "Source enabled" : "Source disabled",
        description: `${job.name} is now ${enabled ? "active" : "inactive"}.`,
      });
      onUpdate();
    }
    setTogglingId(null);
  };

  const handleManualRun = async (job: JobConfiguration) => {
    setRunningId(job.id);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-trade-files", {
        body: { job_id: job.id },
      });

      if (error) throw error;

      toast({
        title: "Fetch complete",
        description: data.results?.[0]?.trades_count
          ? `Processed ${data.results[0].trades_count} trades`
          : "No new trades found",
      });
      onUpdate();
    } catch (error) {
      toast({
        title: "Fetch failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
    setRunningId(null);
  };

  const handleRunCronJob = async (cronJob: CronJobConfiguration) => {
    setRunningCronId(cronJob.id);

    try {
      // For recreate-candles, use the date range (YYYY-MM-DD format)
      const invokeBody = cronJob.id === "recreate-candles" && candleFromDate && candleToDate
        ? { 
            from_date: candleFromDate.toISOString().split('T')[0],
            to_date: candleToDate.toISOString().split('T')[0]
          }
        : {};

      const { data, error } = await supabase.functions.invoke(cronJob.id, {
        body: invokeBody
      });

      if (error) throw error;

      // Some backend functions may return 2xx with an explicit failure payload
      if (data && typeof data === "object" && "success" in data && data.success === false) {
        const message =
          typeof (data as any).message === "string" ? (data as any).message : "Job failed";
        throw new Error(message);
      }

      // Backend functions are responsible for persisting their own run status.
      const result = data as any;
      
      // Build toast message based on response type
      let toastTitle = "Job complete";
      let toastDescription = "Job completed successfully";
      
      if (result?.deleted_count !== undefined) {
        // Cleanup job response
        if (result.hit_limit && result.remaining_count > 0) {
          toastTitle = "Cleanup in progress";
          toastDescription = `Deleted ${result.deleted_count.toLocaleString()} trades. ${result.remaining_count.toLocaleString()} remaining - run again to continue.`;
        } else if (result.deleted_count > 0) {
          toastDescription = `Cleanup complete. Deleted ${result.deleted_count.toLocaleString()} trades.`;
        } else {
          toastDescription = "No old trades to clean up.";
        }
      } else if (result?.count !== undefined) {
        toastDescription = `Synced ${result.count} symbols`;
      } else if (result?.rows_count !== undefined) {
        toastDescription = `Refreshed ${result.rows_count} candles from ${result.trade_count || 0} trades`;
      } else if (result?.message) {
        toastDescription = String(result.message);
      }
      
      toast({
        title: toastTitle,
        description: toastDescription,
      });

      fetchCronJobs();
    } catch (err) {
      // supabase-js provides status/details for non-2xx function responses under `context`
      const status = (err as any)?.context?.status as number | undefined;
      const body = (err as any)?.context?.body;
      const backendMessage =
        typeof body === "string"
          ? (() => {
              try {
                return JSON.parse(body)?.message;
              } catch {
                return undefined;
              }
            })()
          : body?.message;

      // If the backend returned a response (e.g. 408 timeout), do NOT overwrite the
      // backend-managed cron status with a generic "error".
      if (!status) {
        await supabase
          .from("cron_job_configurations")
          .update({
            last_run_at: new Date().toISOString(),
            last_status: "error",
            last_error: err instanceof Error ? err.message : "Unknown error",
          })
          .eq("id", cronJob.id);
      }

      toast({
        title: status === 408 ? "Job timed out" : "Job failed",
        description:
          backendMessage ||
          (err instanceof Error ? err.message : status ? `Request failed (${status})` : "Unknown error"),
        variant: "destructive",
      });

      fetchCronJobs();
    } finally {
      setRunningCronId(null);
    }
  };

  const parseCronSchedule = (schedule: string): string => {
    const parts = schedule.split(" ");
    if (parts.length !== 5) return schedule;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    let description = "";
    
    // Minute interval (e.g., */5 * * * *)
    if (minute.startsWith("*/")) {
      const interval = minute.slice(2);
      return `Every ${interval} min`;
    }
    
    // Hour interval (e.g., 0 */4 * * *)
    if (hour.startsWith("*/")) {
      const interval = hour.slice(2);
      return `Every ${interval} hours`;
    }
    
    // Specific time
    if (hour !== "*" && minute !== "*") {
      description += `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
    }
    
    // Days
    if (dayOfWeek === "1-5") {
      description += " (Mon-Fri)";
    } else if (dayOfWeek === "*" && dayOfMonth === "*") {
      description += " Daily";
    }
    
    return description || schedule;
  };

  const formatJobSchedule = (job: JobConfiguration): string => {
    const days = job.run_days || ["mon", "tue", "wed", "thu", "fri"];
    const startHour = job.run_start_hour ?? 8;
    const endHour = job.run_end_hour ?? 17;
    const timezone = job.timezone || "UTC";
    const intervalMins = Math.round((job.fetch_interval_seconds || 60) / 60);
    
    const isWeekdays = days.length === 5 && 
      ["mon", "tue", "wed", "thu", "fri"].every(d => days.includes(d));
    const isAllDays = days.length === 7;
    
    const daysStr = isAllDays ? "Daily" : isWeekdays ? "Mon-Fri" : days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ");
    
    // Get short timezone label
    const tzLabel = TIMEZONES.find(tz => tz.value === timezone)?.label.split(" ")[0] || timezone;
    
    const intervalStr = intervalMins === 1 ? "1m" : `${intervalMins}m`;
    
    return `${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:00 ${tzLabel} @${intervalStr} (${daysStr})`;
  };

  const formatSourceType = (sourceType: string): string => {
    const typeLabels: Record<string, string> = {
      cboe: "CBOE",
      cboe_bxe: "CBOE BXE",
      cboe_cxe: "CBOE CXE",
      cboe_dxe: "CBOE DXE",
      cboe_sis: "CBOE SIS",
      nasdaq: "Nasdaq",
      lseg: "LSEG",
      lseg_trqx: "LSEG TRQX",
      lseg_tqex: "LSEG TQEX",
      lseg_xlon: "LSEG XLON",
      custom: "Custom",
    };
    return typeLabels[sourceType] || sourceType.toUpperCase();
  };

  const getSourceTypeBadgeClass = (sourceType: string): string => {
    if (sourceType.startsWith("cboe")) return "border-blue-500/50 text-blue-600 dark:text-blue-400";
    if (sourceType.startsWith("lseg")) return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
    if (sourceType === "nasdaq") return "border-cyan-500/50 text-cyan-600 dark:text-cyan-400";
    return "";
  };

  const getSourceDescription = (sourceType: string): string => {
    const descriptions: Record<string, string> = {
      cboe_bxe: "BATS Europe (Amsterdam)",
      cboe_cxe: "Chi-X Europe",
      cboe_dxe: "Dark Pool Europe",
      cboe_sis: "Systematic Internaliser",
      nasdaq: "Nordic Equity Markets",
      lseg_trqx: "Turquoise UK MTF",
      lseg_tqex: "Turquoise Europe MTF",
      lseg_xlon: "London Stock Exchange",
      lseg: "LSEG Markets",
      custom: "Custom data source",
    };
    return descriptions[sourceType] || "Trade data source";
  };

  const getStatusBadge = (job: JobConfiguration) => {
    if (!job.is_enabled) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <MinusCircle className="h-3 w-3 mr-1" />
          Disabled
        </Badge>
      );
    }
    
    switch (job.last_status) {
      case "success":
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case "no_files":
        return (
          <Badge variant="outline" className="border-muted-foreground/50">
            <FileX className="h-3 w-3 mr-1" />
            No Files
          </Badge>
        );
      case "no_data":
        return (
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            <FileWarning className="h-3 w-3 mr-1" />
            No Data
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Partial
          </Badge>
        );
      case "timeout":
        return (
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            Timeout
          </Badge>
        );
      case "skipped":
        return <Badge variant="outline">Skipped</Badge>;
      case "error":
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      case "running":
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const formatResultDetails = (details: JobResultDetails | null | undefined): string[] => {
    if (!details) return [];
    const lines: string[] = [];
    
    if (details.files_found !== undefined || details.files_processed !== undefined) {
      const found = details.files_found ?? 0;
      const processed = details.files_processed ?? 0;
      const empty = details.files_empty ?? 0;
      lines.push(`Files: ${found} found, ${processed} processed${empty > 0 ? `, ${empty} empty` : ''}`);
    }
    
    if (details.trades_parsed !== undefined || details.trades_saved !== undefined) {
      const parsed = details.trades_parsed ?? 0;
      const filtered = details.trades_filtered ?? 0;
      const saved = details.trades_saved ?? 0;
      lines.push(`Trades: ${parsed.toLocaleString()} parsed${filtered > 0 ? `, ${filtered.toLocaleString()} filtered` : ''}, ${saved.toLocaleString()} saved`);
    }
    
    return lines;
  };

  // Format timestamp to local time (e.g., "28 Jan 09:25")
  const formatLocalTime = (dateStr: string | null): string => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return format(date, "d MMM HH:mm");
  };

  const getNextRunTime = (job: JobConfiguration) => {
    if (!job.is_enabled) return { text: "Disabled", isStatus: true };
    if (job.last_status === "running") return { text: "Running", isStatus: true };
    
    // Use next_run_at from database if available
    if (job.next_run_at) {
      const nextRun = new Date(job.next_run_at);
      const now = new Date();
      
      if (nextRun <= now) {
        return { text: "Soon", isStatus: true };
      }
      
      return { text: format(nextRun, "d MMM HH:mm"), isStatus: false };
    }
    
    // Fallback to calculated time
    if (!job.last_run_at) return { text: "Pending", isStatus: true };
    
    const lastRun = new Date(job.last_run_at);
    const interval = job.fetch_interval_seconds || 60;
    const nextRun = addSeconds(lastRun, interval);
    
    if (nextRun < new Date()) {
      return { text: "Soon", isStatus: true };
    }
    
    return { text: format(nextRun, "d MMM HH:mm"), isStatus: false };
  };

  const toggleDay = (day: string) => {
    setJobScheduleConfig(prev => ({
      ...prev,
      run_days: prev.run_days.includes(day)
        ? prev.run_days.filter(d => d !== day)
        : [...prev.run_days, day],
    }));
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Data Ingestion Jobs */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Data Ingestion Jobs</h3>
          <p className="text-sm text-muted-foreground">
            Jobs that fetch trade data from external sources
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96" align="start">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold">{job.name}</h4>
                            <Badge variant="outline" className={getSourceTypeBadgeClass(job.source_type)}>
                              {formatSourceType(job.source_type)}
                            </Badge>
                          </div>
                          
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Base URL</Label>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 text-xs bg-muted p-2 rounded break-all">
                                {job.source_url}
                              </code>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                onClick={() => copyToClipboard(job.source_url)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                asChild
                              >
                                <a href={job.source_url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Description</Label>
                            <p className="text-sm">{getSourceDescription(job.source_type)}</p>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Fetch Frequency</Label>
                            <p className="text-sm">Every {Math.round((job.fetch_interval_seconds || 60) / 60)} minute{Math.round((job.fetch_interval_seconds || 60) / 60) !== 1 ? 's' : ''}</p>
                          </div>

                          {job.last_error && (
                            <div className="space-y-1">
                              <Label className="text-xs text-destructive">Last Error</Label>
                              <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                                {job.last_error}
                              </p>
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <span>{job.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={getSourceTypeBadgeClass(job.source_type)}>
                    {formatSourceType(job.source_type)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{getSourceDescription(job.source_type)}</span>
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-default">
                          {getStatusBadge(job)}
                          {job.last_result_details && (
                            <BarChart3 className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </TooltipTrigger>
                      {job.last_result_details && (
                        <TooltipContent side="right" className="max-w-xs">
                          <div className="space-y-1 text-xs">
                            {formatResultDetails(job.last_result_details).map((line, idx) => (
                              <p key={idx}>{line}</p>
                            ))}
                          </div>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatLocalTime(job.last_run_at)}
                  </span>
                </TableCell>
                <TableCell>
                  {(() => {
                    const nextRun = getNextRunTime(job);
                    return (
                      <span className={cn(
                        "text-sm flex items-center gap-1",
                        nextRun.isStatus ? "text-muted-foreground" : "text-foreground"
                      )}>
                        {nextRun.text}
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <Popover open={editingJobSchedule === job.id} onOpenChange={(open) => {
                    if (open) {
                      setEditingJobSchedule(job.id);
                      setJobScheduleConfig({
                        run_days: job.run_days || ["mon", "tue", "wed", "thu", "fri"],
                        run_start_hour: job.run_start_hour ?? 8,
                        run_end_hour: job.run_end_hour ?? 17,
                        timezone: job.timezone || "UTC",
                        fetch_interval_minutes: Math.round((job.fetch_interval_seconds || 60) / 60),
                      });
                    } else {
                      setEditingJobSchedule(null);
                    }
                  }}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-auto p-1 font-normal">
                        <span className="text-sm text-muted-foreground">{formatJobSchedule(job)}</span>
                        <Settings className="h-3 w-3 ml-1 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 bg-popover">
                      <div className="space-y-4">
                        <h4 className="font-medium">Schedule Configuration</h4>
                        
                        <div className="space-y-2">
                          <Label className="text-sm">Timezone</Label>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            value={jobScheduleConfig.timezone}
                            onChange={(e) => setJobScheduleConfig(prev => ({
                              ...prev,
                              timezone: e.target.value,
                            }))}
                          >
                            {TIMEZONES.map((tz) => (
                              <option key={tz.value} value={tz.value}>
                                {tz.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">Fetch Frequency</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={60}
                              className="w-20"
                              value={jobScheduleConfig.fetch_interval_minutes}
                              onChange={(e) => setJobScheduleConfig(prev => ({
                                ...prev,
                                fetch_interval_minutes: Math.max(1, Math.min(60, parseInt(e.target.value) || 1)),
                              }))}
                            />
                            <span className="text-sm text-muted-foreground">minutes</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            How often to check for new trade data (1-60 min)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">Active Days</Label>
                          <div className="flex flex-wrap gap-2">
                            {DAYS_OF_WEEK.map((day) => (
                              <div key={day.value} className="flex items-center gap-1">
                                <Checkbox
                                  id={`${job.id}-${day.value}`}
                                  checked={jobScheduleConfig.run_days.includes(day.value)}
                                  onCheckedChange={() => toggleDay(day.value)}
                                />
                                <Label htmlFor={`${job.id}-${day.value}`} className="text-xs cursor-pointer">
                                  {day.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-sm">Start Hour</Label>
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={jobScheduleConfig.run_start_hour}
                              onChange={(e) => setJobScheduleConfig(prev => ({
                                ...prev,
                                run_start_hour: parseInt(e.target.value) || 0,
                              }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">End Hour</Label>
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={jobScheduleConfig.run_end_hour}
                              onChange={(e) => setJobScheduleConfig(prev => ({
                                ...prev,
                                run_end_hour: parseInt(e.target.value) || 23,
                              }))}
                            />
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Times are in {TIMEZONES.find(tz => tz.value === jobScheduleConfig.timezone)?.label || jobScheduleConfig.timezone}.
                          DST changes are handled automatically.
                        </p>

                        <Button size="sm" onClick={() => handleJobScheduleUpdate(job)}>
                          Save Schedule
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={job.is_enabled}
                    onCheckedChange={(enabled) => handleToggle(job, enabled)}
                    disabled={togglingId === job.id}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchJobLogs(job)}
                      title="View logs"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleManualRun(job)}
                      disabled={runningId === job.id}
                      title="Run now"
                    >
                      {runningId === job.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            </TableBody>
          </Table>
        </div>

        {jobs.length === 0 && (
          <p className="text-muted-foreground text-center py-8">
            No data ingestion jobs configured.
          </p>
        )}
      </div>

      {/* Section 2: Scheduled Maintenance Jobs */}
      {showCronJobs && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Scheduled Maintenance Jobs</h3>
            <p className="text-sm text-muted-foreground">
              Automated cleanup and maintenance tasks
            </p>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cronJobs.map((cronJob) => (
                  <TableRow key={cronJob.id}>
                    <TableCell className="font-medium">{cronJob.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <Calendar className="h-3 w-3 mr-1" />
                        CRON
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{cronJob.description}</span>
                    </TableCell>
                    <TableCell>
                      {cronJob.last_status === "success" ? (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : cronJob.last_status === "error" ? (
                        <Badge variant="destructive">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Error
                        </Badge>
                      ) : (
                        <Badge variant="outline">Scheduled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatLocalTime(cronJob.last_run_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Popover open={editingSchedule === cronJob.id} onOpenChange={(open) => {
                        if (open) {
                          setEditingSchedule(cronJob.id);
                          setScheduleValue(cronJob.schedule);
                          setRetentionDays(cronJob.retention_days || 30);
                        } else {
                          setEditingSchedule(null);
                        }
                      }}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-auto p-1 font-normal">
                            <span className="text-sm text-muted-foreground">
                              {parseCronSchedule(cronJob.schedule)}
                              {(cronJob.id === "cleanup-old-trades" || cronJob.id === "cleanup-old-candles" || cronJob.id === "cleanup-old-activity-logs" || cronJob.id === "cleanup-old-processed-files") && cronJob.retention_days && (
                                <span className="ml-1">({cronJob.retention_days}d)</span>
                              )}
                            </span>
                            <Settings className="h-3 w-3 ml-1 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="space-y-4">
                            <h4 className="font-medium">Edit Configuration</h4>
                            
                            <div className="space-y-2">
                              <Label className="text-sm">Cron Schedule</Label>
                              <p className="text-xs text-muted-foreground">
                                Format: minute hour day month weekday
                              </p>
                              <Input
                                value={scheduleValue}
                                onChange={(e) => setScheduleValue(e.target.value)}
                                placeholder="0 0 * * *"
                              />
                              <div className="text-xs text-muted-foreground space-y-1">
                                <p><code>0 2 * * *</code> = Daily at 02:00 UTC</p>
                                <p><code>0 8 * * 1-5</code> = Weekdays at 08:00 UTC</p>
                                <p><code>*/5 * * * *</code> = Every 5 minutes</p>
                              </div>
                            </div>

                            {(cronJob.id === "cleanup-old-trades" || cronJob.id === "cleanup-old-candles" || cronJob.id === "cleanup-old-activity-logs" || cronJob.id === "cleanup-old-processed-files") && (
                              <div className="space-y-2">
                                <Label className="text-sm">Retention Period (days)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={365}
                                  value={retentionDays}
                                  onChange={(e) => setRetentionDays(parseInt(e.target.value) || 30)}
                                />
                                <p className="text-xs text-muted-foreground">
                                  {cronJob.id === "cleanup-old-trades" 
                                    ? "Trades older than this will be deleted"
                                    : "Candles older than this will be deleted"}
                                </p>
                              </div>
                            )}

                            {cronJob.id === "recreate-candles" && (
                              <div className="space-y-3">
                                <Label className="text-sm">Backfill Date Range</Label>
                                <p className="text-xs text-muted-foreground">
                                  Select the date range to recreate candles from trade data
                                </p>
                                
                                <div className="space-y-2">
                                  <Label className="text-xs">From Date</Label>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          "w-full justify-start text-left font-normal",
                                          !candleFromDate && "text-muted-foreground"
                                        )}
                                      >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {candleFromDate ? format(candleFromDate, "PPP") : "Pick a date"}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <CalendarComponent
                                        mode="single"
                                        selected={candleFromDate}
                                        onSelect={setCandleFromDate}
                                        disabled={(date) => date > new Date()}
                                        initialFocus
                                        className={cn("p-3 pointer-events-auto")}
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>

                                <div className="space-y-2">
                                  <Label className="text-xs">To Date</Label>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          "w-full justify-start text-left font-normal",
                                          !candleToDate && "text-muted-foreground"
                                        )}
                                      >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {candleToDate ? format(candleToDate, "PPP") : "Pick a date"}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <CalendarComponent
                                        mode="single"
                                        selected={candleToDate}
                                        onSelect={setCandleToDate}
                                        disabled={(date) => date > new Date() || (candleFromDate && date < candleFromDate)}
                                        initialFocus
                                        className={cn("p-3 pointer-events-auto")}
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>

                                <p className="text-xs text-muted-foreground">
                                  Select dates and click Run to backfill candles
                                </p>
                              </div>
                            )}

                            <Button size="sm" onClick={() => handleScheduleUpdate(cronJob)}>
                              Save
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell>
                      <Switch 
                        checked={cronJob.is_enabled} 
                        onCheckedChange={(enabled) => handleCronToggle(cronJob, enabled)}
                        disabled={togglingId === cronJob.id}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchCronJobLogs(cronJob)}
                          title="View logs"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRunCronJob(cronJob)}
                          disabled={runningCronId === cronJob.id}
                          title="Run now"
                        >
                          {runningCronId === cronJob.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {cronJobs.length === 0 && (
            <p className="text-muted-foreground text-center py-8">
              No scheduled maintenance jobs configured.
            </p>
          )}
        </div>
      )}

      {/* Job Logs Drawer - Resizable */}
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
              <FileText className="h-5 w-5" />
              {selectedJobForLogs?.name}
            </SheetTitle>
            <SheetDescription>
              Recent activity logs for this fetch job (last 100 entries)
            </SheetDescription>
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

      {/* Cron Job Logs Drawer */}
      <Sheet 
        open={!!selectedCronJobForLogs} 
        onOpenChange={(open) => !open && setSelectedCronJobForLogs(null)}
      >
        <SheetContent 
          className="w-[700px] sm:w-[800px] sm:max-w-[90vw] p-0 flex flex-col"
          style={{ maxWidth: "90vw" }}
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {selectedCronJobForLogs?.name}
            </SheetTitle>
            <SheetDescription>
              Recent activity logs for this cron job
            </SheetDescription>
            {selectedCronJobForLogs?.last_error && (
              <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive font-medium flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{selectedCronJobForLogs.last_error}</span>
                </p>
              </div>
            )}
          </SheetHeader>
          
          <div className="flex-1 overflow-hidden">
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel defaultSize={100} minSize={30}>
                <ScrollArea className="h-full">
                  {isLoadingCronLogs ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : cronJobLogs.length === 0 ? (
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
                      {cronJobLogs.map((log) => {
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
    </div>
  );
}

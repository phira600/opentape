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
import { RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2, Calendar, Settings, CalendarIcon } from "lucide-react";
import { formatDistanceToNow, addSeconds, format, subDays, startOfDay } from "date-fns";

const DAYS_OF_WEEK = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

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
}

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
  }>({
    run_days: ["mon", "tue", "wed", "thu", "fri"],
    run_start_hour: 6,
    run_end_hour: 21,
  });

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
    
    // Include retention_days if this is the cleanup job
    if (cronJob.id === "cleanup-old-trades") {
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
      // For recreate-candles, use the date range
      const invokeBody = cronJob.id === "recreate-candles" && candleFromDate && candleToDate
        ? { 
            from_date: candleFromDate.toISOString(),
            to_date: candleToDate.toISOString()
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
    const startHour = job.run_start_hour ?? 6;
    const endHour = job.run_end_hour ?? 21;
    
    const isWeekdays = days.length === 5 && 
      ["mon", "tue", "wed", "thu", "fri"].every(d => days.includes(d));
    const isAllDays = days.length === 7;
    
    const daysStr = isAllDays ? "Daily" : isWeekdays ? "Mon-Fri" : days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ");
    
    return `${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:00 (${daysStr})`;
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
    switch (job.last_status) {
      case "success":
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Success
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

  const getNextRunTime = (job: JobConfiguration) => {
    if (!job.is_enabled) return "Disabled";
    if (!job.last_run_at) return "Pending";
    
    const lastRun = new Date(job.last_run_at);
    const interval = job.fetch_interval_seconds || 60;
    const nextRun = addSeconds(lastRun, interval);
    
    if (nextRun < new Date()) {
      return "Soon";
    }
    
    return format(nextRun, "HH:mm:ss");
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
    <div className="space-y-6">
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
            {jobs.map((job) => (
              <TableRow key={job.id}>
              <TableCell className="font-medium">{job.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={getSourceTypeBadgeClass(job.source_type)}>
                    {formatSourceType(job.source_type)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{getSourceDescription(job.source_type)}</span>
                </TableCell>
                <TableCell>{getStatusBadge(job)}</TableCell>
                <TableCell>
                  {job.last_run_at ? (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(job.last_run_at), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Never</span>
                  )}
                </TableCell>
                <TableCell>
                  <Popover open={editingJobSchedule === job.id} onOpenChange={(open) => {
                    if (open) {
                      setEditingJobSchedule(job.id);
                      setJobScheduleConfig({
                        run_days: job.run_days || ["mon", "tue", "wed", "thu", "fri"],
                        run_start_hour: job.run_start_hour ?? 6,
                        run_end_hour: job.run_end_hour ?? 21,
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
                    <PopoverContent className="w-80">
                      <div className="space-y-4">
                        <h4 className="font-medium">Schedule Configuration</h4>
                        
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
                            <Label className="text-sm">Start Hour (UTC)</Label>
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
                            <Label className="text-sm">End Hour (UTC)</Label>
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
                          Job will run every {job.fetch_interval_seconds || 60}s during active hours
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleManualRun(job)}
                    disabled={runningId === job.id}
                  >
                    {runningId === job.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}

        {showCronJobs && cronJobs.map((cronJob) => (
              <TableRow key={cronJob.id} className="bg-muted/30">
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
                  {cronJob.last_run_at ? (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(cronJob.last_run_at), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Never</span>
                  )}
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
                          {cronJob.id === "cleanup-old-trades" && cronJob.retention_days && (
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

                        {cronJob.id === "cleanup-old-trades" && (
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
                              Trades older than this will be deleted
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunCronJob(cronJob)}
                    disabled={runningCronId === cronJob.id}
                  >
                    {runningCronId === cronJob.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

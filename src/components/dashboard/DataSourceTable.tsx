import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
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
import { RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2, Calendar, Settings } from "lucide-react";
import { formatDistanceToNow, addSeconds, format } from "date-fns";

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
}

export function DataSourceTable({ jobs, onUpdate, showCronJobs = true }: DataSourceTableProps) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningCronId, setRunningCronId] = useState<string | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJobConfiguration[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");

  useEffect(() => {
    if (showCronJobs) {
      fetchCronJobs();
    }
  }, [showCronJobs]);

  const fetchCronJobs = async () => {
    const { data, error } = await supabase
      .from("cron_job_configurations")
      .select("*")
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
    const { error } = await supabase
      .from("cron_job_configurations")
      .update({ schedule: scheduleValue })
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
        description: `${cronJob.name} schedule set to: ${scheduleValue}`,
      });
      fetchCronJobs();
    }
    setEditingSchedule(null);
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
      const { data, error } = await supabase.functions.invoke(cronJob.id);

      if (error) throw error;

      // Update last_run_at in the database
      await supabase
        .from("cron_job_configurations")
        .update({ 
          last_run_at: new Date().toISOString(),
          last_status: "success"
        })
        .eq("id", cronJob.id);

      toast({
        title: "Job complete",
        description: data.deleted_count !== undefined
          ? `Cleaned up ${data.deleted_count} old records`
          : data.count !== undefined
          ? `Synced ${data.count} symbols`
          : "Job completed successfully",
      });
      fetchCronJobs();
    } catch (error) {
      await supabase
        .from("cron_job_configurations")
        .update({ 
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: error instanceof Error ? error.message : "Unknown error"
        })
        .eq("id", cronJob.id);

      toast({
        title: "Job failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      fetchCronJobs();
    }
    setRunningCronId(null);
  };

  const parseCronSchedule = (schedule: string): string => {
    const parts = schedule.split(" ");
    if (parts.length !== 5) return schedule;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    let description = "";
    
    // Time
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

  const getStatusBadge = (job: JobConfiguration) => {
    switch (job.last_status) {
      case "success":
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
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

  return (
    <div className="space-y-6">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">{job.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{job.source_type.toUpperCase()}</Badge>
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
                  <span className="text-sm text-muted-foreground">{getNextRunTime(job)}</span>
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
                    disabled={runningId === job.id || !job.is_enabled}
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
                    <span className="text-sm text-muted-foreground">{cronJob.description}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Popover open={editingSchedule === cronJob.id} onOpenChange={(open) => {
                    if (open) {
                      setEditingSchedule(cronJob.id);
                      setScheduleValue(cronJob.schedule);
                    } else {
                      setEditingSchedule(null);
                    }
                  }}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-auto p-1 font-normal">
                        <span className="text-sm text-muted-foreground">{parseCronSchedule(cronJob.schedule)}</span>
                        <Settings className="h-3 w-3 ml-1 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-3">
                        <h4 className="font-medium">Edit Schedule</h4>
                        <p className="text-sm text-muted-foreground">
                          Cron format: minute hour day month weekday
                        </p>
                        <Input
                          value={scheduleValue}
                          onChange={(e) => setScheduleValue(e.target.value)}
                          placeholder="0 0 * * *"
                        />
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p><code>0 0 * * *</code> = Daily at midnight</p>
                          <p><code>0 6 * * 1-5</code> = Weekdays at 06:00</p>
                          <p><code>0 */2 * * *</code> = Every 2 hours</p>
                        </div>
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
                    disabled={runningCronId === cronJob.id || !cronJob.is_enabled}
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

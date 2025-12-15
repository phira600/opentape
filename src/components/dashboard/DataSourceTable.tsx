import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2, Calendar } from "lucide-react";
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

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  description: string;
  lastRun?: string | null;
}

const cronJobs: CronJob[] = [
  {
    id: "cleanup-old-trades",
    name: "Data Cleanup",
    schedule: "Daily at 00:00 UTC",
    description: "Removes trades and logs older than 30 days",
  },
];

export function DataSourceTable({ jobs, onUpdate, showCronJobs = true }: DataSourceTableProps) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningCronId, setRunningCronId] = useState<string | null>(null);

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

  const handleRunCronJob = async (cronJob: CronJob) => {
    setRunningCronId(cronJob.id);
    try {
      const { data, error } = await supabase.functions.invoke(cronJob.id);

      if (error) throw error;

      toast({
        title: "Job complete",
        description: data.deleted_count !== undefined
          ? `Cleaned up ${data.deleted_count} old records`
          : "Job completed successfully",
      });
    } catch (error) {
      toast({
        title: "Job failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
    setRunningCronId(null);
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
                  <Badge variant="outline">Scheduled</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{cronJob.description}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{cronJob.schedule}</span>
                </TableCell>
                <TableCell>
                  <Switch checked={true} disabled />
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

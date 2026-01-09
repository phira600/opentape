import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, RotateCcw } from "lucide-react";
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

export function CronJobsTable() {
  const [jobs, setJobs] = useState<CronJobConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resettingJob, setResettingJob] = useState<string | null>(null);

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

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "success":
        return "text-green-600";
      case "running":
        return "text-blue-600";
      case "failed":
        return "text-red-600";
      case "queued":
        return "text-yellow-600";
      default:
        return "text-muted-foreground";
    }
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
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
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
                      {(job.last_status === "running" || job.last_status === "failed") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resetJobStatus(job.id)}
                          disabled={resettingJob === job.id}
                          title="Reset to idle"
                        >
                          <RotateCcw className={`h-4 w-4 ${resettingJob === job.id ? "animate-spin" : ""}`} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { Info, AlertTriangle, XCircle, CheckCircle } from "lucide-react";

interface ActivityLogEntry {
  id: string;
  job_id: string;
  log_type: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
  job_configurations?: { name: string } | null;
}

export function ActivityLog() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);

  const fetchLogs = async () => {
    const { data } = await supabase
      .from("activity_logs")
      .select("*, job_configurations(name)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      setLogs(data as ActivityLogEntry[]);
    }
  };

  useEffect(() => {
    fetchLogs();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("activity_logs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_logs" },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getLogIcon = (logType: string) => {
    switch (logType) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogBadgeVariant = (logType: string) => {
    switch (logType) {
      case "success":
        return "default" as const;
      case "error":
        return "destructive" as const;
      case "warning":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {logs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No activity yet. Add a data source to get started.
              </p>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  {getLogIcon(log.log_type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getLogBadgeVariant(log.log_type)}>
                        {log.log_type}
                      </Badge>
                      {log.job_configurations?.name && (
                        <span className="text-xs text-muted-foreground">
                          {log.job_configurations.name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{log.message}</p>
                    {log.details && (log.details as { files?: string[] }).files && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {((log.details as { files?: string[] }).files || []).slice(0, 3).join(', ')}
                        {((log.details as { files?: string[] }).files || []).length > 3 && '...'}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(log.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

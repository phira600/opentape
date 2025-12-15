import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";

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
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No activity yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead className="w-[120px]">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant={getLogBadgeVariant(log.log_type)}>
                        {log.log_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {log.message}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.job_configurations?.name || "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.created_at), {
                        addSuffix: true,
                      })}
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

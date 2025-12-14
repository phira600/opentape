import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface JobConfiguration {
  id: string;
  name: string;
  source_url: string;
  source_type: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

interface DataSourceCardProps {
  job: JobConfiguration;
  onUpdate: () => void;
}

export function DataSourceCard({ job, onUpdate }: DataSourceCardProps) {
  const { toast } = useToast();
  const [isToggling, setIsToggling] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    setIsToggling(true);
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
    setIsToggling(false);
  };

  const handleManualRun = async () => {
    setIsRunning(true);
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
    setIsRunning(false);
  };

  const getStatusBadge = () => {
    switch (job.last_status) {
      case "success":
        return <Badge variant="default" className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Success</Badge>;
      case "error":
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Error</Badge>;
      case "running":
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{job.name}</CardTitle>
          <Switch
            checked={job.is_enabled}
            onCheckedChange={handleToggle}
            disabled={isToggling}
          />
        </div>
        <Badge variant="outline" className="w-fit">{job.source_type.toUpperCase()}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground truncate" title={job.source_url}>
          {job.source_url}
        </div>
        
        <div className="flex items-center justify-between">
          {getStatusBadge()}
          {job.last_run_at && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(job.last_run_at), { addSuffix: true })}
            </span>
          )}
        </div>

        {job.last_error && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {job.last_error}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleManualRun}
          disabled={isRunning || !job.is_enabled}
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Run Now
        </Button>
      </CardContent>
    </Card>
  );
}

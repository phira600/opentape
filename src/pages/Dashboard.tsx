import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/dashboard/Header";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { DataSourceTable } from "@/components/dashboard/DataSourceTable";
import { ActivityLog } from "@/components/dashboard/ActivityLog";
import { TradesTable } from "@/components/dashboard/TradesTable";
import { SymbolExplorer } from "@/components/dashboard/SymbolExplorer";
import { ProcessedFilesTable } from "@/components/dashboard/ProcessedFilesTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

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

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = async () => {
    const { data, error } = await supabase
      .from("job_configurations")
      .select("*")
      .order("name", { ascending: true });

    if (!error && data) {
      setJobs(data);
    }
    setIsLoading(false);
  };

  const provisionDefaultJobs = async () => {
    try {
      const { error } = await supabase.functions.invoke("provision-default-jobs");
      if (error) {
        console.error("Failed to provision default jobs:", error);
      }
    } catch (e) {
      console.error("Error provisioning jobs:", e);
    }
  };

  useEffect(() => {
    // Provision default jobs on first load, then fetch
    provisionDefaultJobs().then(() => fetchJobs());

    // Subscribe to realtime updates for job status changes
    const channel = supabase
      .channel('job-status-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'job_configurations',
        },
        () => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <StatsCards />
        
        <Tabs defaultValue="sources" className="space-y-4">
          <TabsList>
            <TabsTrigger value="sources">Data Jobs</TabsTrigger>
            <TabsTrigger value="explorer">Trade Explorer</TabsTrigger>
            <TabsTrigger value="symbols">Symbol Explorer</TabsTrigger>
            <TabsTrigger value="logs">Logs & Files</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="space-y-4">
            <h2 className="text-lg font-semibold">Data Jobs</h2>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No data sources configured.
              </p>
            ) : (
              <DataSourceTable jobs={jobs} onUpdate={fetchJobs} />
            )}
          </TabsContent>

          <TabsContent value="explorer">
            <TradesTable />
          </TabsContent>

          <TabsContent value="symbols">
            <SymbolExplorer />
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <ActivityLog />
              <ProcessedFilesTable />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
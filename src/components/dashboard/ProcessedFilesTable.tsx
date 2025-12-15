import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { FileText } from "lucide-react";

interface ProcessedFile {
  id: string;
  job_id: string;
  file_name: string;
  file_hash: string;
  records_count: number;
  processed_at: string;
  job_configurations?: { name: string } | null;
}

export function ProcessedFilesTable() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    const { data, error } = await supabase
      .from("processed_files")
      .select("*, job_configurations(name)")
      .order("processed_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      setFiles(data as ProcessedFile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Processed Files
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : files.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No files processed yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Processed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {file.file_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {file.job_configurations?.name || "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{file.records_count}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(file.processed_at), {
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
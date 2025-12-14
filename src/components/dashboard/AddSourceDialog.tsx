import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2 } from "lucide-react";

interface AddSourceDialogProps {
  onAdded: () => void;
}

export function AddSourceDialog({ onAdded }: AddSourceDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceType, setSourceType] = useState<string>("custom");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await supabase.from("job_configurations").insert({
      name,
      source_url: sourceUrl,
      source_type: sourceType,
      is_enabled: true,
    });

    if (error) {
      toast({
        title: "Failed to add source",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Source added",
        description: `${name} has been added to your data sources.`,
      });
      setOpen(false);
      setName("");
      setSourceUrl("");
      setSourceType("custom");
      onAdded();
    }
    setIsLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Data Source</DialogTitle>
          <DialogDescription>
            Configure a new trade data source to fetch from.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="CBOE Europe Trades"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">Source URL</Label>
            <Input
              id="source-url"
              type="url"
              placeholder="https://api.example.com/trades"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Source Type</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cboe">CBOE</SelectItem>
                <SelectItem value="lseg">LSEG</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Source
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

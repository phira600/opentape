import { useState, useEffect } from "react";
import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Key, Copy, Trash2, Plus, Shield, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface IpWhitelistEntry {
  id: string;
  ip_address: string;
  description: string | null;
  created_at: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
  ip_whitelist?: IpWhitelistEntry[];
}

export default function Settings() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [newIpAddress, setNewIpAddress] = useState("");
  const [newIpDescription, setNewIpDescription] = useState("");
  const [addingIp, setAddingIp] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const { data: keys, error: keysError } = await supabase
        .from("api_keys")
        .select("id, name, prefix, created_at, last_used_at, is_active")
        .order("created_at", { ascending: false });

      if (keysError) throw keysError;

      // Fetch IP whitelist for each key
      const { data: whitelist, error: whitelistError } = await supabase
        .from("api_key_ip_whitelist")
        .select("id, api_key_id, ip_address, description, created_at");

      if (whitelistError) throw whitelistError;

      // Map whitelist entries to their API keys
      const keysWithWhitelist = (keys || []).map(key => ({
        ...key,
        ip_whitelist: (whitelist || []).filter(w => w.api_key_id === key.id),
      }));

      setApiKeys(keysWithWhitelist);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const generateApiKey = (): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let key = "tdh_";
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  };

  const hashApiKey = async (key: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }

    setCreatingKey(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to create API keys");
        return;
      }

      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);

      const { error } = await supabase.from("api_keys").insert({
        name: newKeyName.trim(),
        key_hash: keyHash,
        prefix: apiKey,
        user_id: user.id,
      });

      if (error) throw error;

      setNewlyCreatedKey(apiKey);
      setNewKeyName("");
      fetchApiKeys();
      toast.success("API key created successfully");
    } catch (error) {
      console.error("Error creating API key:", error);
      toast.error("Failed to create API key");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
      fetchApiKeys();
      toast.success("API key deleted");
    } catch (error) {
      console.error("Error deleting API key:", error);
      toast.error("Failed to delete API key");
    }
  };

  const handleAddIp = async (keyId: string) => {
    if (!newIpAddress.trim()) {
      toast.error("Please enter an IP address");
      return;
    }

    // Basic IP validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(newIpAddress.trim())) {
      toast.error("Please enter a valid IP address (e.g., 192.168.1.1)");
      return;
    }

    try {
      const { error } = await supabase.from("api_key_ip_whitelist").insert({
        api_key_id: keyId,
        ip_address: newIpAddress.trim(),
        description: newIpDescription.trim() || null,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This IP is already whitelisted for this key");
        } else {
          throw error;
        }
        return;
      }

      setNewIpAddress("");
      setNewIpDescription("");
      setAddingIp(null);
      fetchApiKeys();
      toast.success("IP address added to whitelist");
    } catch (error) {
      console.error("Error adding IP:", error);
      toast.error("Failed to add IP address");
    }
  };

  const handleDeleteIp = async (ipId: string) => {
    try {
      const { error } = await supabase.from("api_key_ip_whitelist").delete().eq("id", ipId);
      if (error) throw error;
      fetchApiKeys();
      toast.success("IP address removed from whitelist");
    } catch (error) {
      console.error("Error deleting IP:", error);
      toast.error("Failed to remove IP address");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setNewlyCreatedKey(null);
    setNewKeyName("");
  };

  const toggleKeyExpanded = (keyId: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) {
        next.delete(keyId);
      } else {
        next.add(keyId);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your API keys and preferences</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Keys
                </CardTitle>
                <CardDescription>
                  Manage API keys for accessing the opentape APIs
                </CardDescription>
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create API Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New API Key</DialogTitle>
                    <DialogDescription>
                      {newlyCreatedKey
                        ? "Your new API key has been created."
                        : "Enter a name to identify this API key."}
                    </DialogDescription>
                  </DialogHeader>

                  {newlyCreatedKey ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Your API Key</Label>
                        <div className="flex gap-2">
                          <Input
                            value={newlyCreatedKey}
                            readOnly
                            className="font-mono"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(newlyCreatedKey)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="keyName">Key Name</Label>
                        <Input
                          id="keyName"
                          placeholder="e.g., Production API"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    {newlyCreatedKey ? (
                      <Button onClick={handleDialogClose}>Done</Button>
                    ) : (
                      <Button onClick={handleCreateKey} disabled={creatingKey}>
                        {creatingKey ? "Creating..." : "Create Key"}
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : apiKeys.length === 0 ? (
              <p className="text-muted-foreground">No API keys yet. Create one to get started.</p>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <Collapsible
                    key={key.id}
                    open={expandedKeys.has(key.id)}
                    onOpenChange={() => toggleKeyExpanded(key.id)}
                  >
                    <div className="border rounded-lg">
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="p-0 h-6 w-6">
                                {expandedKeys.has(key.id) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{key.name}</span>
                                <Badge variant={key.is_active ? "default" : "secondary"}>
                                  {key.is_active ? "Active" : "Inactive"}
                                </Badge>
                                {key.ip_whitelist && key.ip_whitelist.length > 0 && (
                                  <Badge variant="outline" className="gap-1">
                                    <Shield className="h-3 w-3" />
                                    {key.ip_whitelist.length} IP{key.ip_whitelist.length !== 1 ? "s" : ""}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate">
                                  {key.prefix}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => copyToClipboard(key.prefix)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
                            <span>Last used: {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</span>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{key.name}"? This action cannot be undone and any applications using this key will stop working.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteKey(key.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="border-t p-4 bg-muted/30">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-medium flex items-center gap-2">
                                  <Shield className="h-4 w-4" />
                                  IP Whitelist
                                </h4>
                                <p className="text-sm text-muted-foreground">
                                  {key.ip_whitelist?.length === 0
                                    ? "No IP restrictions. Requests from any IP are allowed."
                                    : "Only requests from these IP addresses are allowed."}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAddingIp(addingIp === key.id ? null : key.id)}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add IP
                              </Button>
                            </div>

                            {addingIp === key.id && (
                              <div className="flex gap-2 items-end">
                                <div className="flex-1">
                                  <Label htmlFor={`ip-${key.id}`} className="text-sm">IP Address</Label>
                                  <Input
                                    id={`ip-${key.id}`}
                                    placeholder="e.g., 192.168.1.1"
                                    value={newIpAddress}
                                    onChange={(e) => setNewIpAddress(e.target.value)}
                                  />
                                </div>
                                <div className="flex-1">
                                  <Label htmlFor={`desc-${key.id}`} className="text-sm">Description (optional)</Label>
                                  <Input
                                    id={`desc-${key.id}`}
                                    placeholder="e.g., Office server"
                                    value={newIpDescription}
                                    onChange={(e) => setNewIpDescription(e.target.value)}
                                  />
                                </div>
                                <Button onClick={() => handleAddIp(key.id)}>Add</Button>
                                <Button variant="outline" onClick={() => {
                                  setAddingIp(null);
                                  setNewIpAddress("");
                                  setNewIpDescription("");
                                }}>Cancel</Button>
                              </div>
                            )}

                            {key.ip_whitelist && key.ip_whitelist.length > 0 && (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>IP Address</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Added</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {key.ip_whitelist.map((ip) => (
                                    <TableRow key={ip.id}>
                                      <TableCell className="font-mono">{ip.ip_address}</TableCell>
                                      <TableCell className="text-muted-foreground">
                                        {ip.description || "-"}
                                      </TableCell>
                                      <TableCell>{new Date(ip.created_at).toLocaleDateString()}</TableCell>
                                      <TableCell>
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                              <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Remove IP</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                Remove {ip.ip_address} from the whitelist? Requests from this IP will no longer be allowed if other IPs are still whitelisted.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction
                                                onClick={() => handleDeleteIp(ip.id)}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                              >
                                                Remove
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
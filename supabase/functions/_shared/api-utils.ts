// Shared API utilities for edge functions
// Provides cached API key validation, IP whitelist checking, and response caching

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Cache-Control": "public, max-age=60",
};

// ============= API Key Cache =============
const API_KEY_CACHE = new Map<string, { valid: boolean; keyId: string | null; expires: number }>();
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

// ============= IP Whitelist Cache =============
const IP_WHITELIST_CACHE = new Map<string, { allowed: boolean; expires: number }>();
const IP_WHITELIST_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ============= Response Cache =============
const RESPONSE_CACHE = new Map<string, { data: any; expires: number }>();
const RESPONSE_CACHE_TTL_MS = 60 * 1000; // 1 minute

export function getCachedResponse(key: string): any | null {
  const entry = RESPONSE_CACHE.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  RESPONSE_CACHE.delete(key);
  return null;
}

export function setCachedResponse(key: string, data: any, ttlMs: number = RESPONSE_CACHE_TTL_MS) {
  if (RESPONSE_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = RESPONSE_CACHE.keys().next().value;
    if (oldestKey) RESPONSE_CACHE.delete(oldestKey);
  }
  RESPONSE_CACHE.set(key, { data, expires: Date.now() + ttlMs });
}

export async function validateApiKey(
  supabase: any, 
  apiKey: string
): Promise<{ valid: boolean; keyId: string | null }> {
  if (!apiKey) return { valid: false, keyId: null };
  
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expires > Date.now()) {
    if (cached.valid && cached.keyId) {
      EdgeRuntime.waitUntil(
        supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", cached.keyId)
      );
    }
    return { valid: cached.valid, keyId: cached.keyId };
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  const { data: keyData, error } = await supabase
    .from("api_keys")
    .select("id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();
  
  const isValid = !error && !!keyData;
  
  if (API_KEY_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = API_KEY_CACHE.keys().next().value;
    if (oldestKey) API_KEY_CACHE.delete(oldestKey);
  }
  
  API_KEY_CACHE.set(apiKey, { 
    valid: isValid, 
    keyId: keyData?.id || null, 
    expires: Date.now() + API_KEY_CACHE_TTL_MS 
  });
  
  if (isValid && keyData?.id) {
    EdgeRuntime.waitUntil(
      supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyData.id)
    );
  }
  
  return { valid: isValid, keyId: keyData?.id || null };
}

export async function checkIpWhitelist(
  supabase: any, 
  keyId: string, 
  clientIp: string
): Promise<boolean> {
  const cacheKey = `${keyId}:${clientIp}`;
  
  // Check cache first
  const cached = IP_WHITELIST_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.allowed;
  }
  
  const { data: whitelist, error } = await supabase
    .from("api_key_ip_whitelist")
    .select("ip_address")
    .eq("api_key_id", keyId);
  
  if (error) {
    console.error("IP whitelist check error:", error);
    return true; // Allow if we can't check
  }
  
  // If no whitelist entries, allow all IPs
  if (!whitelist || whitelist.length === 0) {
    // Cache this result too
    IP_WHITELIST_CACHE.set(cacheKey, { allowed: true, expires: Date.now() + IP_WHITELIST_CACHE_TTL_MS });
    return true;
  }
  
  // Check if client IP is in whitelist
  const allowed = whitelist.some((w: { ip_address: string }) => w.ip_address === clientIp);
  
  // Cache the result
  if (IP_WHITELIST_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = IP_WHITELIST_CACHE.keys().next().value;
    if (oldestKey) IP_WHITELIST_CACHE.delete(oldestKey);
  }
  IP_WHITELIST_CACHE.set(cacheKey, { allowed, expires: Date.now() + IP_WHITELIST_CACHE_TTL_MS });
  
  return allowed;
}

export function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    || req.headers.get("cf-connecting-ip") 
    || req.headers.get("x-real-ip")
    || "unknown";
}

export function errorResponse(message: string, status: number = 400): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

export function jsonResponse(data: any, cacheHit: boolean = false): Response {
  return new Response(
    JSON.stringify(data),
    { 
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        ...(cacheHit ? { "X-Cache": "HIT" } : { "X-Cache": "MISS" })
      } 
    }
  );
}

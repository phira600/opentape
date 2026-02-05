

# LSEG Headerless Access Fix

## Problem Analysis

The LSEG data fetching is failing because the current implementation uses minimal HTTP headers when requesting files from `dmd.lseg.com`. While LSEG's new DMD service (launched December 2025) no longer requires user registration, it still employs anti-bot measures that validate request headers.

### Current Implementation Issue

The existing fetch call in `supabase/functions/fetch-trade-files/index.ts` (lines 1047-1052) only sends:

```text
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: text/csv,application/gzip,*/*
```

This is insufficient - the LSEG server expects headers that indicate a legitimate browser session.

### Evidence

- All 3 LSEG jobs (TRQX, TQEX, XLON) are currently **disabled**
- Last successful runs were on January 9, 2026
- No recent LSEG-related entries in activity logs
- The server likely returns 403 Forbidden or redirects to a challenge page when headers are incomplete

---

## Solution

Update the LSEG fetch headers to fully mimic a browser session. This approach is already used successfully for Nasdaq fetching (lines 789-795) which includes `Referer` and `Origin` headers.

### Changes Required

**File**: `supabase/functions/fetch-trade-files/index.ts`

**Location**: Lines 1047-1052 (the `fetchLsegDataSinceLastRun` function)

**Update the headers object to include:**

| Header | Value | Purpose |
|--------|-------|---------|
| `User-Agent` | Full Chrome UA string | Identify as modern browser |
| `Accept` | `text/csv,application/gzip,application/octet-stream,*/*` | Accept file types |
| `Accept-Language` | `en-GB,en-US;q=0.9,en;q=0.8` | Language preference |
| `Accept-Encoding` | `gzip, deflate, br` | Compression support |
| `Referer` | `https://dmd.lseg.com/` | Simulate navigation from DMD homepage |
| `Origin` | `https://dmd.lseg.com` | CORS origin |
| `Connection` | `keep-alive` | Persistent connection |
| `Cache-Control` | `no-cache` | Prevent cached responses |
| `Sec-Fetch-Dest` | `document` | Browser security context |
| `Sec-Fetch-Mode` | `navigate` | Navigation mode |
| `Sec-Fetch-Site` | `same-origin` | Same-origin request |

### Code Change

```typescript
// Replace lines 1047-1052 with:
const response = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/csv,application/gzip,application/octet-stream,*/*',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://dmd.lseg.com/',
    'Origin': 'https://dmd.lseg.com',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin'
  }
})
```

---

## Additional Improvements

### 1. Add Request Delay Between Batches

The current 200ms delay between batches may be too aggressive. Increase to 500-1000ms to avoid rate limiting:

```typescript
// Line 1094: Change from 200 to 500
await new Promise(r => setTimeout(r, 500))
```

### 2. Add Response Status Logging

Improve debugging by logging HTTP status for failed requests:

```typescript
if (!response.ok) {
  console.log(`LSEG: ${fileName} failed with HTTP ${response.status}`)
}
```

### 3. Reduce Batch Size

Consider reducing from 5 concurrent requests to 3 to be gentler on the server:

```typescript
// Line 1036: Change batch size from 5 to 3
for (let i = 0; i < urlsToTry.length; i += 3) {
  const batch = urlsToTry.slice(i, i + 3)
```

---

## Alternative Solutions (If Headers Don't Work)

If the extended headers approach still fails, here are fallback options:

### Option A: Headless Browser Proxy

Use a service like Browserless.io or Puppeteer-as-a-service to fetch files through a real browser instance. This would require:
- Adding an API key for the browser service
- Creating a proxy edge function that uses the browser API

### Option B: Server-Side Scraping Service

Use Firecrawl (already available as a connector) to scrape the LSEG DMD page and extract file URLs with full browser rendering.

### Option C: Official LSEG API

Contact LSEG to inquire about official API access for post-trade data. MiFID II regulations require venues to provide free delayed data, but the delivery mechanism may have official endpoints beyond the web interface.

---

## Implementation Steps

1. Update the LSEG fetch headers in `fetch-trade-files` edge function
2. Increase batch delay to 500ms
3. Add improved error logging
4. Deploy the edge function
5. Enable one LSEG job (e.g., `lseg_xlon`) for testing
6. Manually trigger the job and monitor logs
7. Verify files are downloaded successfully

---

## Technical Details

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/fetch-trade-files/index.ts` | Update headers in LSEG fetch (lines 1047-1052), increase delay (line 1094), reduce batch size (line 1036) |

### Expected Outcome

- LSEG files should download successfully with proper browser-like headers
- HTTP 200 responses instead of 403 or redirects
- Trade data from LSE, Turquoise UK, and Turquoise Europe venues restored


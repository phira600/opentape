

## Plan: Add Expandable File Details to Job Log Drawer

### Current State

The backend already stores detailed per-file information in `activity_logs.details.file_details`:
```typescript
{
  name: string;      // File name
  lines: number;     // Total data lines
  trades: number;    // Valid trades saved
  filtered: number;  // Filtered out trades
}
```

The log drawer currently shows summary badges but doesn't display this per-file breakdown.

### Solution

Add an expandable/collapsible section to each log entry that shows the per-file details when `file_details` is present.

### UI Design

```text
[success] Jan 30, 08:30:18 (5 min ago)
Processed 5 files with 3802 trades

[>] 5 files processed | 0 filtered   <-- Click to expand

    Expanded view:
    +---------------------------------------+
    | File                        | Trades  |
    | bxe_2026-01-30_0813.csv    | 618     |
    | bxe_2026-01-30_0814.csv    | 762     |
    | bxe_2026-01-30_0815.csv    | 820     |
    | bxe_2026-01-30_0816.csv    | 749     |
    | bxe_2026-01-30_0817.csv    | 853     |
    +---------------------------------------+
```

### Changes Required

#### `src/components/dashboard/DataSourceTable.tsx`

**Change 1**: Add import for Collapsible component (line ~32)
```typescript
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
```

**Change 2**: Define interface for file details (around line 43)
```typescript
interface FileDetail {
  name: string;
  lines: number;
  trades: number;
  filtered: number;
}
```

**Change 3**: Update `formatLogMessage` function to extract file_details (lines 234-300)

Update the return type and extract `file_details`:
```typescript
const formatLogMessage = (log: ActivityLogEntry): { 
  title: string; 
  details: string[]; 
  error?: string;
  fileDetails?: FileDetail[];
} => {
  // ... existing code ...
  
  // Extract file_details if present
  let fileDetails: FileDetail[] | undefined;
  if (d.file_details && Array.isArray(d.file_details)) {
    fileDetails = d.file_details as FileDetail[];
  }
  
  return { title, details, error, fileDetails };
};
```

**Change 4**: Update the log entry rendering in the drawer (lines 1374-1426)

Add a collapsible section after the details badges when `fileDetails` is present:
```tsx
{fileDetails && fileDetails.length > 0 && (
  <Collapsible className="mt-3">
    <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
      <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
      <span>{fileDetails.length} files processed</span>
      {fileDetails.some(f => f.filtered > 0) && (
        <span className="text-orange-500">
          ({fileDetails.reduce((sum, f) => sum + f.filtered, 0)} filtered)
        </span>
      )}
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-2">
      <div className="rounded-md border bg-muted/30 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-1.5 font-medium">File</th>
              <th className="text-right px-3 py-1.5 font-medium w-20">Lines</th>
              <th className="text-right px-3 py-1.5 font-medium w-20">Trades</th>
              {fileDetails.some(f => f.filtered > 0) && (
                <th className="text-right px-3 py-1.5 font-medium w-20">Filtered</th>
              )}
            </tr>
          </thead>
          <tbody>
            {fileDetails.map((file, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-mono truncate max-w-[300px]" title={file.name}>
                  {file.name}
                </td>
                <td className="text-right px-3 py-1.5 text-muted-foreground">
                  {file.lines.toLocaleString()}
                </td>
                <td className="text-right px-3 py-1.5">
                  {file.trades > 0 ? (
                    <span className="text-green-600">{file.trades.toLocaleString()}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                {fileDetails.some(f => f.filtered > 0) && (
                  <td className="text-right px-3 py-1.5">
                    {file.filtered > 0 ? (
                      <span className="text-orange-500">{file.filtered.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleContent>
  </Collapsible>
)}
```

### Summary

| Location | Change |
|----------|--------|
| Line ~32 | Add Collapsible import |
| Line ~43 | Add FileDetail interface |
| Lines 234-300 | Update formatLogMessage to extract fileDetails |
| Lines 1374-1426 | Add collapsible file details table in log entry |

### Visual Result

- Each log entry with file data will show a clickable "X files processed" link
- Clicking expands to show a compact table with file names, line counts, trade counts, and filtered counts
- Empty/filtered files are visually distinguished
- Collapsed by default to keep the drawer clean


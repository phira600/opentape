
## Plan: Separate Fetch Jobs and Maintenance Jobs into Two Tables

### Overview

Currently, the Data Jobs tab displays both data ingestion jobs (CBOE BXE, CBOE CXE, Nasdaq Nordic, etc.) and maintenance/cron jobs (Trades Cleanup, Candles Cleanup, Symbology, etc.) in a single combined table. This change will split them into two clearly labeled sections with separate tables for better organization.

### Visual Layout

```text
+--------------------------------------------------+
|  Data Jobs Tab                                   |
+--------------------------------------------------+
|                                                  |
|  Data Ingestion Jobs                             |
|  +--------------------------------------------+  |
|  | Name | Type | Description | Status | ...   |  |
|  |--------------------------------------------|  |
|  | CBOE BXE    | CBOE | European equities ... |  |
|  | CBOE CXE    | CBOE | European equities ... |  |
|  | Nasdaq Nordic | NASDAQ | Nordic markets ...|  |
|  +--------------------------------------------+  |
|                                                  |
|  Scheduled Maintenance Jobs                      |
|  +--------------------------------------------+  |
|  | Name | Type | Description | Status | ...   |  |
|  |--------------------------------------------|  |
|  | Trades Cleanup    | CRON | Removes trades..|  |
|  | Candles Cleanup   | CRON | Removes candles.|  |
|  | CBOE SIS Symbology| CRON | Fetches symbol..|  |
|  +--------------------------------------------+  |
|                                                  |
+--------------------------------------------------+
```

### Implementation Details

#### 1. Refactor DataSourceTable Component

Split the current single table into two separate table sections:

- **Section 1: "Data Ingestion Jobs"** - Displays only fetch jobs from `job_configurations`
- **Section 2: "Scheduled Maintenance Jobs"** - Displays only cron jobs from `cron_job_configurations`

Each section will have its own:
- Section heading with description
- Full table with appropriate headers
- Empty state message if no jobs exist

#### 2. Updated Table Headers

**Data Ingestion Jobs Table:**
| Name | Type | Description | Status | Last Run | Next Run | Schedule | Enabled | Actions |

**Scheduled Maintenance Jobs Table:**
| Name | Type | Description | Status | Last Run | Schedule | Enabled | Actions |

Note: "Next Run" column is removed from maintenance jobs since they use cron schedules rather than interval-based timing.

#### 3. Code Changes

**File:** `src/components/dashboard/DataSourceTable.tsx`

Changes to make:
1. Wrap the current table in a container with a heading "Data Ingestion Jobs"
2. Create a second table container with heading "Scheduled Maintenance Jobs"
3. Move cron job rows from the combined TableBody to the new separate table
4. Add descriptive subtitles for each section
5. Adjust the table structure so each has its own complete Table component

### Technical Implementation

```text
<div className="space-y-8">
  {/* Section 1: Data Ingestion Jobs */}
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-semibold">Data Ingestion Jobs</h3>
      <p className="text-sm text-muted-foreground">
        Jobs that fetch trade data from external sources
      </p>
    </div>
    <div className="rounded-md border">
      <Table>
        {/* Fetch jobs table header and body */}
      </Table>
    </div>
  </div>

  {/* Section 2: Scheduled Maintenance Jobs */}
  {showCronJobs && (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Scheduled Maintenance Jobs</h3>
        <p className="text-sm text-muted-foreground">
          Automated cleanup and maintenance tasks
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          {/* Cron jobs table header and body */}
        </Table>
      </div>
    </div>
  )}
</div>
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/DataSourceTable.tsx` | Split single table into two separate tables with section headings |
| `src/pages/Dashboard.tsx` | Remove the generic "Data Jobs" h2 heading (now handled by the component sections) |

### Benefits

- Clear visual separation between data fetching and maintenance operations
- Easier to scan and manage each type of job
- More intuitive organization matching how administrators think about these jobs
- Each table can have headers optimized for its job type

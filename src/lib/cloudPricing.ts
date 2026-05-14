// Lovable Cloud pricing constants for the opentape cost simulator.
// Source: https://docs.lovable.dev/integrations/cloud (last reviewed 2026-05).
// These are best-effort estimates of the underlying Supabase usage rates that
// Lovable Cloud bills for. Update the numbers below if Lovable's pricing changes.

export const FREE_CLOUD_ALLOWANCE_USD = 25;

export type InstanceTier = "micro" | "small" | "medium";

export const INSTANCE_TIERS: Record<InstanceTier, { label: string; usdPerMonth: number }> = {
  micro: { label: "Micro (shared, ~1 GB RAM)", usdPerMonth: 10 },
  small: { label: "Small (~2 GB RAM)", usdPerMonth: 25 },
  medium: { label: "Medium (~4 GB RAM)", usdPerMonth: 60 },
};

// Per-unit prices (USD)
export const PRICE = {
  storagePerGbMonth: 0.125,            // database storage
  egressPerGb: 0.09,                   // data transfer out
  edgeInvocationsPerMillion: 2.0,      // edge function invocations
  dbReadsPerMillion: 0.50,             // approx. cost of heavy read traffic
};

// Heuristics
export const BYTES_PER_TRADE = 250; // row + indexes, conservative

export interface SimulatorInputs {
  venues: number;
  fetchIntervalMin: number;
  marketHoursPerDay: number;
  tradingDaysPerMonth: number;
  tradesPerDay: number;
  retentionDays: number;
  apiRequestsPerDay: number;
  avgResponseKb: number;
  instance: InstanceTier;
}

export const DEFAULT_INPUTS: SimulatorInputs = {
  venues: 6,
  fetchIntervalMin: 5,
  marketHoursPerDay: 9,
  tradingDaysPerMonth: 21,
  tradesPerDay: 500_000,
  retentionDays: 7,
  apiRequestsPerDay: 1_000,
  avgResponseKb: 5,
  instance: "micro",
};

export interface CostLine {
  label: string;
  usage: string;
  unitPrice: string;
  costUsd: number;
}

export interface CostBreakdown {
  lines: CostLine[];
  computeUsd: number;
  usageUsd: number;
  freeAllowanceApplied: number;
  totalUsd: number;
}

export function calculateCost(inputs: SimulatorInputs): CostBreakdown {
  const ingestionInvocations =
    inputs.venues *
    (60 / Math.max(1, inputs.fetchIntervalMin)) *
    inputs.marketHoursPerDay *
    inputs.tradingDaysPerMonth;

  const apiInvocationsMonth = inputs.apiRequestsPerDay * 30;
  const totalInvocations = ingestionInvocations + apiInvocationsMonth;

  const storageGb =
    (inputs.tradesPerDay * inputs.retentionDays * BYTES_PER_TRADE) / 1e9;

  const egressGb = (inputs.apiRequestsPerDay * 30 * inputs.avgResponseKb) / 1e6;

  // Approx DB read units: each API call scans ~1k rows on average
  const dbReadsMillion = (apiInvocationsMonth * 1000) / 1e6;

  const compute = INSTANCE_TIERS[inputs.instance].usdPerMonth;
  const invocationCost = (totalInvocations / 1e6) * PRICE.edgeInvocationsPerMillion;
  const storageCost = storageGb * PRICE.storagePerGbMonth;
  const egressCost = egressGb * PRICE.egressPerGb;
  const readsCost = dbReadsMillion * PRICE.dbReadsPerMillion;

  const lines: CostLine[] = [
    {
      label: `Compute — ${INSTANCE_TIERS[inputs.instance].label}`,
      usage: "fixed",
      unitPrice: `$${compute.toFixed(2)} / mo`,
      costUsd: compute,
    },
    {
      label: "Edge function invocations",
      usage: `${formatNumber(totalInvocations)} / mo`,
      unitPrice: `$${PRICE.edgeInvocationsPerMillion.toFixed(2)} / M`,
      costUsd: invocationCost,
    },
    {
      label: "Database storage",
      usage: `${storageGb.toFixed(2)} GB`,
      unitPrice: `$${PRICE.storagePerGbMonth.toFixed(3)} / GB·mo`,
      costUsd: storageCost,
    },
    {
      label: "Database reads (estimated)",
      usage: `${dbReadsMillion.toFixed(2)} M rows`,
      unitPrice: `$${PRICE.dbReadsPerMillion.toFixed(2)} / M`,
      costUsd: readsCost,
    },
    {
      label: "Egress (API responses)",
      usage: `${egressGb.toFixed(3)} GB`,
      unitPrice: `$${PRICE.egressPerGb.toFixed(2)} / GB`,
      costUsd: egressCost,
    },
  ];

  const usageUsd = invocationCost + storageCost + egressCost + readsCost;
  const grossTotal = compute + usageUsd;
  const freeAllowanceApplied = Math.min(FREE_CLOUD_ALLOWANCE_USD, grossTotal);
  const totalUsd = Math.max(0, grossTotal - freeAllowanceApplied);

  return {
    lines,
    computeUsd: compute,
    usageUsd,
    freeAllowanceApplied,
    totalUsd,
  };
}

function formatNumber(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toString();
}

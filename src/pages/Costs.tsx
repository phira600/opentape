import { useMemo, useState } from "react";
import { SmartHeader } from "@/components/SmartHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wallet, Info } from "lucide-react";
import {
  DEFAULT_INPUTS,
  INSTANCE_TIERS,
  InstanceTier,
  SimulatorInputs,
  calculateCost,
  FREE_CLOUD_ALLOWANCE_USD,
} from "@/lib/cloudPricing";

export default function Costs() {
  const [inputs, setInputs] = useState<SimulatorInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => calculateCost(inputs), [inputs]);

  const update = <K extends keyof SimulatorInputs>(key: K, value: SimulatorInputs[K]) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  const verdict =
    result.totalUsd <= 20
      ? { label: "Fits in $20/mo", variant: "default" as const, color: "text-green-500" }
      : result.totalUsd <= 50
      ? { label: "$20–50/mo", variant: "secondary" as const, color: "text-yellow-500" }
      : { label: "Above $50/mo", variant: "destructive" as const, color: "text-red-500" };

  return (
    <div className="min-h-screen bg-background">
      <SmartHeader />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center gap-3 mb-2">
          <Wallet className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Running cost simulator</h1>
        </div>
        <p className="text-lg text-muted-foreground mb-8">
          Estimate the monthly Lovable Cloud cost of running opentape with your own parameters.
        </p>

        {/* Explainer */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              How Lovable Cloud pricing works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-muted-foreground text-sm">
            <p>
              Lovable Cloud is usage-based and billed on top of your Lovable subscription.
              Every workspace gets a <strong className="text-foreground">${FREE_CLOUD_ALLOWANCE_USD} free Cloud
              allowance per month</strong>; you only pay for what exceeds it.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong className="text-foreground">Compute</strong>: fixed monthly fee per database instance tier (Micro is enough for opentape's defaults).</li>
              <li><strong className="text-foreground">Edge function invocations</strong>: every venue fetch and every API call counts.</li>
              <li><strong className="text-foreground">Database storage</strong>: trades + candles, scaled by retention days.</li>
              <li><strong className="text-foreground">Egress</strong>: bytes returned by your public API.</li>
              <li><strong className="text-foreground">Build credits</strong> (Lovable subscription) are separate and not included here.</li>
            </ul>
            <p className="text-xs italic pt-2">
              Unit prices are best-effort estimates from the Lovable Cloud docs. Treat the result as
              an order-of-magnitude estimate, not a billing quote.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Inputs */}
          <Card>
            <CardHeader>
              <CardTitle>Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <SliderRow
                label="Enabled venues"
                value={inputs.venues}
                min={1}
                max={10}
                onChange={(v) => update("venues", v)}
              />
              <SliderRow
                label="Fetch interval (minutes per venue)"
                value={inputs.fetchIntervalMin}
                min={1}
                max={60}
                onChange={(v) => update("fetchIntervalMin", v)}
              />
              <SliderRow
                label="Market hours per day"
                value={inputs.marketHoursPerDay}
                min={1}
                max={24}
                onChange={(v) => update("marketHoursPerDay", v)}
              />
              <SliderRow
                label="Trading days per month"
                value={inputs.tradingDaysPerMonth}
                min={1}
                max={31}
                onChange={(v) => update("tradingDaysPerMonth", v)}
              />
              <SliderRow
                label="Data retention (days)"
                value={inputs.retentionDays}
                min={1}
                max={90}
                onChange={(v) => update("retentionDays", v)}
              />
              <NumberRow
                label="Trades ingested per day"
                value={inputs.tradesPerDay}
                step={10000}
                onChange={(v) => update("tradesPerDay", v)}
              />
              <NumberRow
                label="External API requests per day"
                value={inputs.apiRequestsPerDay}
                step={100}
                onChange={(v) => update("apiRequestsPerDay", v)}
              />
              <NumberRow
                label="Average API response size (KB)"
                value={inputs.avgResponseKb}
                step={1}
                onChange={(v) => update("avgResponseKb", v)}
              />

              <div className="space-y-2">
                <Label>Instance tier</Label>
                <Select
                  value={inputs.instance}
                  onValueChange={(v) => update("instance", v as InstanceTier)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INSTANCE_TIERS).map(([key, tier]) => (
                      <SelectItem key={key} value={key}>
                        {tier.label} — ${tier.usdPerMonth}/mo
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Result */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Estimated monthly cost</span>
                <Badge variant={verdict.variant}>{verdict.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-5xl font-bold mb-2 ${verdict.color}`}>
                ${result.totalUsd.toFixed(2)}
                <span className="text-base text-muted-foreground font-normal"> / month</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Gross usage ${(result.computeUsd + result.usageUsd).toFixed(2)} − $
                {result.freeAllowanceApplied.toFixed(2)} free Cloud allowance.
              </p>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.lines.map((line) => (
                    <TableRow key={line.label}>
                      <TableCell className="font-medium">{line.label}</TableCell>
                      <TableCell className="text-muted-foreground">{line.usage}</TableCell>
                      <TableCell className="text-muted-foreground">{line.unitPrice}</TableCell>
                      <TableCell className="text-right">${line.costUsd.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium">
                      Free Cloud allowance
                    </TableCell>
                    <TableCell className="text-right text-green-500">
                      −${result.freeAllowanceApplied.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <p className="text-xs text-muted-foreground italic mt-4">
                Note: build credits used to develop the app via Lovable are billed separately
                from Cloud usage and are not included in this estimate.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <Label>{label}</Label>
        <span className="text-sm text-muted-foreground tabular-nums">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function NumberRow({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

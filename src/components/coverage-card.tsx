import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents, formatPercent } from "@/lib/format-money";
import type { CoverageSummary } from "@/types";

export function CoverageCard({ coverage }: { coverage: CoverageSummary }) {
  // A plan charges a flat copay or a coinsurance percentage, not both. Showing
  // the one that does not apply as "Unknown" reads as missing data rather than
  // as inapplicable, so the tile switches to whichever the plan actually uses.
  const usesCoinsurance = coverage.copayEstimateCents === null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Coverage</CardTitle>
        {/* Active coverage is a completed step, so it takes the restrained green
            rather than the navy that every other default badge carries. */}
        <Badge variant={coverage.active ? "success" : "destructive"}>
          {coverage.active ? "Active" : "Inactive"}
        </Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 text-base">
        <div>
          <p className="text-sm text-muted-foreground">Plan</p>
          <p className="font-medium">{coverage.planName}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Network</p>
          <p className="font-medium capitalize">{coverage.network}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            {usesCoinsurance ? "Coinsurance" : "Estimated copay"}
          </p>
          <p className="font-medium">
            {usesCoinsurance
              ? formatPercent(coverage.coinsuranceRate)
              : formatCents(coverage.copayEstimateCents)}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Deductible remaining</p>
          <p className="font-medium">{formatCents(coverage.deductibleRemainingCents)}</p>
        </div>
        {/* Sponsor visibility as a small native label attached to what it
            actually produced (doc section 8), not a logo wall. */}
        <p className="col-span-2 text-sm text-muted-foreground">
          Eligibility checked with Stedi
        </p>
      </CardContent>
    </Card>
  );
}

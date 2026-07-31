import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CoverageSummary } from "@/types";

function formatCents(cents: number | null): string {
  if (cents === null) return "Unknown";
  return `$${(cents / 100).toFixed(2)}`;
}

export function CoverageCard({ coverage }: { coverage: CoverageSummary }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Coverage</CardTitle>
        <Badge variant={coverage.active ? "default" : "destructive"}>
          {coverage.active ? "Active" : "Inactive"}
        </Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Plan</p>
          <p className="font-medium">{coverage.planName}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Network</p>
          <p className="font-medium capitalize">{coverage.network}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Estimated copay</p>
          <p className="font-medium">{formatCents(coverage.copayEstimateCents)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Deductible remaining</p>
          <p className="font-medium">{formatCents(coverage.deductibleRemainingCents)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

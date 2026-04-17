import fs from "fs";
import path from "path";

type CoverageMetricMap = Record<string, number | number[]>;
type CoverageFileEntry = Partial<Record<"s" | "b" | "f" | "l", CoverageMetricMap>>;
type CoverageReport = Record<string, CoverageFileEntry>;

const coveragePath = path.join(process.cwd(), "coverage", "coverage-final.json");

if (!fs.existsSync(coveragePath)) {
  console.error(`Coverage report not found at ${coveragePath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(coveragePath, "utf8")) as CoverageReport;

function percentage(covered: number, total: number): number {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

function aggregateMetric(items: CoverageReport, key: "s" | "b" | "f" | "l"): number {
  let covered = 0;
  let total = 0;

  for (const file of Object.values(items)) {
    const metric = file[key];
    if (!metric) continue;

    for (const value of Object.values(metric)) {
      if (Array.isArray(value)) {
        for (const branchCount of value) {
          if (branchCount > 0) covered += 1;
          total += 1;
        }
      } else {
        if (value > 0) covered += 1;
        total += 1;
      }
    }
  }

  return percentage(covered, total);
}

const totals = {
  statements: aggregateMetric(report, "s"),
  branches: aggregateMetric(report, "b"),
  functions: aggregateMetric(report, "f"),
  lines: aggregateMetric(report, "l")
};

const thresholds = {
  statements: 80,
  branches: 55,
  functions: 80,
  lines: 78
};

let failed = false;

for (const [metric, threshold] of Object.entries(thresholds)) {
  const actual = totals[metric as keyof typeof totals];
  const actualRounded = Number(actual.toFixed(2));
  console.log(`${metric}: ${actualRounded}% (threshold ${threshold}%)`);

  if (actual + 1e-9 < threshold) {
    failed = true;
    console.error(`Coverage threshold not met for ${metric}: ${actualRounded}% < ${threshold}%`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("Coverage thresholds satisfied.");

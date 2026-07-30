/**
 * Golden check: Excel-only Outputs after COM must match written bill usage.
 *
 * Usage: node scripts/verify-outputs-merge.mjs
 */
import { calculateAssessment } from "../src/services/excelCalculator.service.js";
import { getTemplatePath } from "../src/config/excelMapping.js";

const formData = {
  propertyType: "Home",
  template: "Typical 3-Bedroom Home",
  country: "Nigeria",
  city: "Lagos",
  powerSetup: "Grid + Generator",
  inputMethod: "bill",
  mainObjective: "Reduce Electricity Bills",
  monthlyElectricityBill: "100000",
  bill: {
    fileName: "",
    notes: "",
    monthlyUsage: "450",
    usageUnit: "kWh",
    monthlySpend: "100000",
    gridTariff: "220",
  },
  appliance: { rows: [] },
  custom: { rows: [] },
  roofArea: "100",
  backupDuration: "4",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function near(a, b, tol = 0.15) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) / Math.max(Math.abs(b), 1) <= tol;
}

console.log("Template:", getTemplatePath());
console.log("Calculating (Excel-only Outputs)...");

const api = await calculateAssessment(formData);

const expectedKwp = (450 * 12) / 1450;
const expectedShare = 0.9;

console.log("\nResults:", {
  solar: api.recommendedSolarKwp,
  battery: api.recommendedBatteryKwh,
  inverter: api.recommendedInverterKw,
  cost: api.estimatedSystemCost,
  solarShare: api.solarShare,
  gridOffset: api.gridOffset,
  dieselReduction: api.dieselReduction,
  billMonthly: api.summary?.bill?.monthlyUsage,
});

let failed = 0;
const checks = [
  ["recommendedSolarKwp", api.recommendedSolarKwp, expectedKwp],
  ["solarShare", api.solarShare, expectedShare],
];

for (const [key, actual, expected] of checks) {
  const a = num(actual);
  const ok = near(a, expected);
  if (!ok) failed += 1;
  console.log(
    `${ok ? "OK" : "FAIL"} ${key}: got=${a} expected≈${Number(expected).toFixed(3)}`,
  );
}

if (num(api.recommendedSolarKwp) <= 0.6) {
  console.error("FAIL: solar looks like stale tiny/floor value");
  failed += 1;
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nExcel-only Outputs look correct for 450 kWh bill.");

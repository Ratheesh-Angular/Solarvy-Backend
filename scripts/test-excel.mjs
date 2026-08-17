/**
 * Quick local smoke test for Excel integration.
 * Run: node scripts/test-excel.mjs
 * Prefill simulates Appliance_Input INDEX/CHOOSE (no recalc engine).
 * Full calculation requires LibreOffice or Windows Microsoft Excel.
 */
import "dotenv/config";
import { getCatalogs } from "../src/services/excelReader.service.js";
import {
  getTemplatePrefill,
  calculateAssessment,
} from "../src/services/excelCalculator.service.js";
import { getLibreOfficePath } from "../src/config/excelMapping.js";
import fs from "node:fs";

const WINDOWS_EXCEL_PATHS = [
  "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
  "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
];

function hasRecalcEngine() {
  const libre = getLibreOfficePath();
  if (libre !== "soffice" && fs.existsSync(libre)) return "LibreOffice";
  if (fs.existsSync("C:\\Program Files\\LibreOffice\\program\\soffice.com")) {
    return "LibreOffice";
  }
  if (process.platform === "win32" && WINDOWS_EXCEL_PATHS.some((p) => fs.existsSync(p))) {
    return "Microsoft Excel COM";
  }
  return null;
}

const sampleForm = {
  propertyType: "Home",
  template: "2-Bedroom Flat",
  country: "Nigeria",
  city: "Lagos",
  powerSetup: "Grid + Generator",
  inputMethod: "bill",
  mainObjective: "Reduce Electricity Bills",
  roofArea: "200",
  backupDuration: "4",
  bill: {
    monthlyUsage: "450",
    monthlySpend: "180000",
    gridTariff: "55",
  },
  appliance: { rows: [] },
  custom: { rows: [] },
};

function assertNumber(label, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    throw new Error(`${label} missing or not a number: ${value}`);
  }
  console.log(`   ${label}:`, value);
}

async function main() {
  const engine = hasRecalcEngine();
  console.log("Recalculation engine:", engine ?? "none");
  if (!engine) {
    console.error(
      "\nNo recalc engine found. Run: npm run setup:local (LibreOffice) or install Microsoft Excel.",
    );
    process.exit(1);
  }

  console.log("\n1. Catalogs...");
  const catalogs = await getCatalogs();
  console.log("   propertyTypes:", catalogs.propertyTypes.join(", "));
  console.log("   equipment items:", catalogs.equipmentCatalog.length);

  console.log("\n2. Template prefill (Home / 2-Bedroom Flat)...");
  const prefill = await getTemplatePrefill("Home", "2-Bedroom Flat");
  console.log("   appliance rows:", prefill.applianceRows.length);
  if (prefill.applianceRows[0]) {
    console.log("   first row:", JSON.stringify(prefill.applianceRows[0]));
  }
  console.log("   summary:", prefill.summary);

  console.log("\n3. Full calculation (bill method)...");
  const results = await calculateAssessment(sampleForm);

  console.log("   propertyType:", results.propertyType);
  assertNumber("recommendedSolarKwp", results.recommendedSolarKwp);
  assertNumber("recommendedBatteryKwh", results.recommendedBatteryKwh);
  assertNumber("estimatedSystemCost (B15)", results.estimatedSystemCost);
  assertNumber("grossAnnualSavings (B16)", results.grossAnnualSavings);
  assertNumber("annualOmAllowance (B17)", results.annualOmAllowance);
  assertNumber("netAnnualSavings (B18)", results.netAnnualSavings);
  assertNumber("simplePaybackYears (B19)", results.simplePaybackYears);
  assertNumber("solarShare (B27)", results.solarShare);
  assertNumber("gridOffset (B28)", results.gridOffset);
  assertNumber("dieselReduction (B29)", results.dieselReduction);
  if (!results.systemClass || typeof results.systemClass !== "string") {
    throw new Error(`systemClass (B31) missing or invalid: ${results.systemClass}`);
  }
  console.log("   systemClass (B31):", results.systemClass);

  if (results.propertyType !== sampleForm.propertyType) {
    throw new Error(
      `propertyType mismatch: expected ${sampleForm.propertyType}, got ${results.propertyType}`,
    );
  }

  console.log("\nAll Excel tests passed.");
}

main().catch((err) => {
  console.error("\nTest failed:", err.message);
  process.exit(1);
});

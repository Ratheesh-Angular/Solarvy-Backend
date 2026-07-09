import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getTemplatePath() {
  return (
    process.env.EXCEL_TEMPLATE_PATH ||
    path.resolve(__dirname, "../../templates/solarvy-calculator.xlsx")
  );
}

export function getTempDir() {
  return process.env.EXCEL_TEMP_DIR || path.join(os.tmpdir(), "solarvy-excel");
}

export function getLibreOfficePath() {
  return process.env.LIBREOFFICE_PATH || "soffice";
}

export function getCalcTimeoutMs() {
  return Number(process.env.EXCEL_CALC_TIMEOUT_MS) || 90_000;
}

export const SHEETS = {
  userInputs: "User_Inputs",
  billInput: "Bill_Input",
  equipmentDefault: "Equipment Default",
  categoryMenu: "Category Menu",
  applianceInput: "Appliance_Input",
  customEquipment: "Custom_Equipment",
  outputs: "Outputs",
};

/** User_Inputs sheet cells that receive user values. */
export const USER_INPUT_CELLS = {
  country: "B7",
  state: "B8",
  propertyType: "B10",
  template: "B11",
  powerSetup: "B13",
  mainObjective: "B14",
  inputMethod: "B15",
  monthlyUsageKwh: "B18",
  roofArea: "B21",
  backupDuration: "B25",
  // Bill_Input!B7 derives tariff from this fallback input; writing Bill_Input!B7
  // directly would destroy the client's formula.
  gridTariff: "B30",
};

export const BILL_INPUT_CELLS = {
  monthlySpend: "B6",
};

/** UI input method id -> Excel dropdown label (User_Inputs!B15). */
export const INPUT_METHOD_LABELS = {
  bill: "Bill",
  appliance: "Appliances",
  custom: "Custom",
};

export const APPLIANCE_TABLE = {
  sheet: SHEETS.applianceInput,
  startRow: 4,
  endRow: 23,
  columns: { name: "A", qty: "B", watts: "C", hours: "D", dutyCycle: "E" },
};

export const CUSTOM_TABLE = {
  sheet: SHEETS.customEquipment,
  startRow: 4,
  endRow: 23,
  columns: { name: "A", watts: "B", loadFactor: "C", qty: "D", hours: "E" },
};

/**
 * Fallback template ranges on User_Inputs (mirror the workbook's named ranges).
 * The reader resolves the real defined names first; these are used only if
 * defined-name resolution fails.
 */
export const TEMPLATE_RANGES = {
  Home: "L4:L10",
  Hotel: "L13:L17",
  Commercial: "L20:L28",
  Factory: "L31:L38",
  Hospital: "L41:L45",
  School: "L48:L53",
};

export const DROPDOWN_FALLBACKS = {
  propertyTypes: ["Home", "Hotel", "Commercial", "Factory", "Hospital", "School"],
  powerSetups: [
    "Grid Only",
    "Grid + Generator",
    "Solar + Grid",
    "Generator Only",
    "No Reliable Grid",
  ],
  objectives: [
    "Reduce Electricity Bills",
    "Reduce Diesel Use",
    "Backup During Outages",
  ],
  countries: ["Nigeria", "Ghana", "Kenya"],
  backupDurations: ["1", "2", "3", "4", "5", "6", "7", "8"],
};

export const STATE_RANGE = "I4:I40";
export const CITY_RANGE = "J4:J45";

/** Outputs sheet -> result payload keys. */
export const OUTPUT_CELLS = {
  assessmentId: "B4",
  scenarioName: "B5",
  country: "B6",
  propertyType: "B7",
  powerSetup: "B8",
  objective: "B9",
  recommendedSolarKwp: "B10",
  recommendedBatteryKwh: "B11",
  recommendedInverterKw: "B12",
  annualPvGenerationKwh: "B13",
  usableSolarKwh: "B14",
  estimatedSystemCost: "B15",
  grossAnnualSavings: "B16",
  annualOmAllowance: "B17",
  netAnnualSavings: "B18",
  simplePaybackYears: "B19",
  dieselSavedLitres: "B20",
  leadType: "B21",
  recommendedNextStep: "B22",
  primaryRecommendation: "B23",
  confidenceNote: "B24",
  disclaimer: "B25",
  solarShare: "B27",
  gridOffset: "B28",
  dieselReduction: "B29",
};

/** Summary cells read back after recalculation (authoritative values). */
export const SUMMARY_CELLS = {
  bill: { sheet: SHEETS.billInput, monthlyUsage: "B5" },
  appliance: { sheet: SHEETS.applianceInput, dailyKwh: "L4", monthlyKwh: "L5" },
  custom: { sheet: SHEETS.customEquipment, dailyKwh: "M4", monthlyKwh: "M5" },
};

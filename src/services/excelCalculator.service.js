import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import {
  getTemplatePath,
  getTempDir,
  getLibreOfficePath,
  getCalcTimeoutMs,
  SHEETS,
  USER_INPUT_CELLS,
  BILL_INPUT_CELLS,
  INPUT_METHOD_LABELS,
  APPLIANCE_TABLE,
  CUSTOM_TABLE,
  OUTPUT_CELLS,
  SUMMARY_CELLS,
  ESTIMATED_ANNUAL_LOAD_CELLS,
  OUTPUT_LIVE_SUMMARY_CELLS,
} from "../config/excelMapping.js";
import { cellValue } from "./excelReader.service.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCEL_COM_SCRIPT = path.resolve(
  __dirname,
  "../../scripts/recalc-excel-com.ps1",
);

const WINDOWS_EXCEL_PATHS = [
  "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
  "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
];

const LIBREOFFICE_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.com",
  "/usr/bin/soffice",
  "/usr/lib/libreoffice/program/soffice",
];

function libreOfficeAvailable() {
  const configured = getLibreOfficePath();
  if (configured && configured !== "soffice" && fs.existsSync(configured)) {
    return true;
  }
  return LIBREOFFICE_CANDIDATES.some((p) => fs.existsSync(p));
}

/** Resolve configured or detected LibreOffice binary for exec. */
function resolveLibreOfficePath() {
  const configured = getLibreOfficePath();
  if (configured && configured !== "soffice" && fs.existsSync(configured)) {
    return configured;
  }
  const found = LIBREOFFICE_CANDIDATES.find((p) => fs.existsSync(p));
  return found || configured || "soffice";
}

function excelComAvailable() {
  if (process.platform !== "win32") return false;
  if (process.env.EXCEL_USE_COM === "false") return false;
  return WINDOWS_EXCEL_PATHS.some((p) => fs.existsSync(p));
}

/** Recalculate in-place via Microsoft Excel COM (Windows local dev). */
async function recalculateWithExcelCom(inputPath, inputsJsonPath = null) {
  // Stale Excel.exe instances often break Workbooks.Open for automation.
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue",
      ],
      { timeout: 15_000, windowsHide: true },
    );
  } catch {
    // best-effort
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    EXCEL_COM_SCRIPT,
    "-InputPath",
    inputPath,
  ];
  if (inputsJsonPath) {
    args.push("-InputsJson", inputsJsonPath);
  }

  const { stdout, stderr } = await execFileAsync("powershell.exe", args, {
    timeout: getCalcTimeoutMs(),
    windowsHide: true,
  });
  if (stdout) console.log(String(stdout).trim());
  if (stderr) console.warn(String(stderr).trim());
  const combined = `${stdout || ""}\n${stderr || ""}`;
  if (!combined.includes("COM_DIAG") && !combined.includes("OK_RECALC")) {
    throw new Error(
      `Excel COM recalculation failed to open or calculate the workbook. Close Excel if ${path.basename(getTemplatePath())} is open. Details: ${combined.trim() || "no output"}`,
    );
  }
  return { outPath: inputPath, cleanupDir: null };
}

function buildComInputsPayload(formData) {
  const methodLabel = INPUT_METHOD_LABELS[formData.inputMethod];
  const payload = {
    country: formData.country || null,
    city: formData.city || formData.state || null,
    propertyType: formData.propertyType || null,
    template: formData.template || null,
    powerSetup: formData.powerSetup || null,
    mainObjective: formData.mainObjective || null,
    inputMethod: methodLabel || null,
    roofArea: toNumber(formData.roofArea),
    backupDuration: toNumber(formData.backupDuration),
    monthlyUsageKwh: null,
    gridTariff: null,
    monthlySpend: null,
    applianceRows: null,
    customRows: null,
    applianceTable: {
      startRow: APPLIANCE_TABLE.startRow,
      templateEndRow: APPLIANCE_TABLE.templateEndRow ?? 20,
      endRow: APPLIANCE_TABLE.endRow,
    },
    customTable: {
      startRow: CUSTOM_TABLE.startRow,
      endRow: CUSTOM_TABLE.endRow,
    },
  };

  if (formData.inputMethod === "bill" && formData.bill) {
    payload.monthlyUsageKwh = toNumber(formData.bill.monthlyUsage);
    payload.gridTariff = toNumber(formData.bill.gridTariff);
    payload.monthlySpend = toNumber(formData.bill.monthlySpend);
  }

  if (formData.inputMethod === "appliance" && formData.appliance?.rows?.length) {
    payload.applianceRows = formData.appliance.rows
      .map((row) => {
        const excelRow = Number(row.excelRow);
        if (!Number.isFinite(excelRow)) {
          console.warn(
            "Appliance row missing excelRow; skipping COM write:",
            row.kind || row.name,
          );
          return null;
        }
        return {
          excelRow,
          source: row.source || "user",
          name: row.kind || row.name || "",
          qty: Number(row.qty) || 0,
          watts: Number(row.power ?? row.watts) || 0,
          hours: Number(row.hours) || 0,
          dutyCycle:
            row.dutyCycle !== undefined
              ? Number(row.dutyCycle) || 0
              : (Number(row.loadFactorPct) || 0) / 100,
        };
      })
      .filter(Boolean);
  }

  if (formData.inputMethod === "custom" && formData.custom?.rows?.length) {
    payload.customRows = formData.custom.rows
      .map((row) => {
        const excelRow = Number(row.excelRow);
        if (!Number.isFinite(excelRow)) {
          console.warn(
            "Custom row missing excelRow; skipping COM write:",
            row.kind || row.name,
          );
          return null;
        }
        return {
          excelRow,
          name: row.kind || row.name || "",
          watts: Number(row.power) || 0,
          loadFactor: customLoadFactorFromPct(row.loadFactorPct),
          qty: Number(row.qty) || 0,
          hours: Number(row.hours) || 0,
        };
      })
      .filter(Boolean);
  }

  return payload;
}

function ensureTempDir() {
  const dir = getTempDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newWorkPath(tag) {
  const id = `${tag}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return path.join(ensureTempDir(), `${id}.xlsx`);
}

/**
 * Recalculate a workbook with LibreOffice headless (production / Linux EC2).
 */
async function recalculateWithLibreOffice(inputPath) {
  const outDir = path.join(
    ensureTempDir(),
    `out-${crypto.randomUUID().slice(0, 8)}`,
  );
  fs.mkdirSync(outDir, { recursive: true });

  const soffice = resolveLibreOfficePath();
  try {
    await execFileAsync(
      soffice,
      [
        "--headless",
        "--norestore",
        "--convert-to",
        'xlsx:Calc MS Excel 2007 XML:{"RecalcOptions":{"type":"string","value":"force"}}',
        "--outdir",
        outDir,
        inputPath,
      ],
      { timeout: getCalcTimeoutMs(), windowsHide: true },
    );
  } catch {
    await execFileAsync(
      soffice,
      [
        "--headless",
        "--norestore",
        "--convert-to",
        "xlsx",
        "--outdir",
        outDir,
        inputPath,
      ],
      { timeout: getCalcTimeoutMs(), windowsHide: true },
    );
  }

  const outPath = path.join(outDir, path.basename(inputPath));
  if (!fs.existsSync(outPath)) {
    throw new Error("LibreOffice did not produce a recalculated workbook");
  }
  return { outPath, cleanupDir: outDir };
}

/** Prefer Excel COM on Windows (matches desktop Excel); LibreOffice is fallback. */
async function recalculateWorkbook(inputPath, formData = null) {
  if (excelComAvailable()) {
    console.log("Using Microsoft Excel COM for local recalculation");
    let inputsJsonPath = null;
    if (formData) {
      inputsJsonPath = path.join(
        ensureTempDir(),
        `inputs-${crypto.randomUUID().slice(0, 8)}.json`,
      );
      fs.writeFileSync(
        inputsJsonPath,
        JSON.stringify(buildComInputsPayload(formData), null, 2),
        "utf8",
      );
    }
    try {
      return await recalculateWithExcelCom(inputPath, inputsJsonPath);
    } finally {
      if (inputsJsonPath) safeUnlink(inputsJsonPath);
    }
  }
  if (libreOfficeAvailable()) {
    console.log("Using LibreOffice for recalculation");
    return recalculateWithLibreOffice(inputPath);
  }
  throw new Error(
    "No Excel recalculation engine found. Install LibreOffice (npm run setup:local) or use Windows with Microsoft Excel.",
  );
}

function useComDirectWrites() {
  return excelComAvailable();
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function setCell(sheet, ref, value) {
  if (value === undefined || value === null || value === "") return;
  sheet.getCell(ref).value = value;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** UI loadFactorPct 0–100 → Excel Appliance duty fraction (0–1). 0 stays 0. */
function loadFactorFractionFromPct(loadFactorPct) {
  if (loadFactorPct === null || loadFactorPct === undefined || loadFactorPct === "") {
    return 1;
  }
  const n = Number(loadFactorPct);
  if (!Number.isFinite(n)) return 1;
  return n / 100;
}

/**
 * Custom_Equipment!C is used raw in Watts×Load_Factor×Qty×Hours/1000 (no ÷100).
 * Write the same 0–100 number the UI shows.
 */
function customLoadFactorFromPct(loadFactorPct) {
  if (loadFactorPct === null || loadFactorPct === undefined || loadFactorPct === "") {
    return 0;
  }
  const n = Number(loadFactorPct);
  return Number.isFinite(n) ? n : 0;
}

/** Write assessment formData into a workbook copy. */
function writeInputs(workbook, formData) {
  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const billInput = workbook.getWorksheet(SHEETS.billInput);

  setCell(userInputs, USER_INPUT_CELLS.country, formData.country);
  setCell(userInputs, USER_INPUT_CELLS.state, formData.city || formData.state);
  setCell(userInputs, USER_INPUT_CELLS.propertyType, formData.propertyType);
  setCell(userInputs, USER_INPUT_CELLS.template, formData.template);
  setCell(userInputs, USER_INPUT_CELLS.powerSetup, formData.powerSetup);
  setCell(userInputs, USER_INPUT_CELLS.mainObjective, formData.mainObjective);

  const methodLabel = INPUT_METHOD_LABELS[formData.inputMethod];
  setCell(userInputs, USER_INPUT_CELLS.inputMethod, methodLabel);

  setCell(userInputs, USER_INPUT_CELLS.roofArea, toNumber(formData.roofArea));
  setCell(
    userInputs,
    USER_INPUT_CELLS.backupDuration,
    toNumber(formData.backupDuration),
  );

  if (formData.inputMethod === "bill" && formData.bill) {
    setCell(
      userInputs,
      USER_INPUT_CELLS.monthlyUsageKwh,
      toNumber(formData.bill.monthlyUsage),
    );
    setCell(
      userInputs,
      USER_INPUT_CELLS.gridTariff,
      toNumber(formData.bill.gridTariff),
    );
    setCell(
      billInput,
      BILL_INPUT_CELLS.monthlySpend,
      toNumber(formData.bill.monthlySpend),
    );
  }

  if (formData.inputMethod === "appliance" && formData.appliance?.rows) {
    writeApplianceRows(workbook, formData.appliance.rows);
  }

  if (formData.inputMethod === "custom" && formData.custom?.rows) {
    writeTableRows(workbook, CUSTOM_TABLE, formData.custom.rows, (row) => ({
      name: row.kind,
      watts: Number(row.power) || 0,
      loadFactor: customLoadFactorFromPct(row.loadFactorPct),
      qty: Number(row.qty) || 0,
      hours: Number(row.hours) || 0,
    }));
  }
}

/** Input columns only — never touch formula columns like G (dailyKwh). */
const APPLIANCE_INPUT_COLS = ["name", "qty", "watts", "hours", "dutyCycle"];

function mapApplianceRowInputs(row) {
  return {
    name: row.kind || row.name || "",
    qty: Number(row.qty) || 0,
    watts: Number(row.power ?? row.watts) || 0,
    hours: Number(row.hours) || 0,
    dutyCycle:
      row.dutyCycle !== undefined
        ? Number(row.dutyCycle) || 0
        : Number(row.loadFactorPct ?? 100) / 100,
  };
}

/**
 * Template zone (A4:A20): write B–E only so INDEX/CHOOSE name formulas stay.
 * User zone (A21+): write A–E per stable excelRow slot (includes qty=0 removed rows).
 */
function writeApplianceRows(workbook, rows) {
  const table = APPLIANCE_TABLE;
  const sheet = workbook.getWorksheet(table.sheet);
  const cols = table.columns;
  const templateEnd = table.templateEndRow ?? 20;
  const userStart = templateEnd + 1;

  const referencedTemplateSlots = new Set();
  const referencedUserSlots = new Set();

  for (const row of rows || []) {
    const excelRow = Number(row.excelRow);
    if (!Number.isFinite(excelRow)) continue;

    const mapped = mapApplianceRowInputs(row);
    const isTemplate =
      row.source === "template" ||
      (excelRow >= table.startRow && excelRow <= templateEnd);

    if (isTemplate && excelRow >= table.startRow && excelRow <= templateEnd) {
      referencedTemplateSlots.add(excelRow);
      for (const key of APPLIANCE_INPUT_COLS) {
        if (key === "name") continue;
        sheet.getCell(`${cols[key]}${excelRow}`).value =
          mapped[key] !== undefined ? mapped[key] : null;
      }
    } else if (excelRow >= userStart && excelRow <= table.endRow) {
      referencedUserSlots.add(excelRow);
      for (const key of APPLIANCE_INPUT_COLS) {
        sheet.getCell(`${cols[key]}${excelRow}`).value =
          mapped[key] !== undefined ? mapped[key] : null;
      }
    }
  }

  for (let r = table.startRow; r <= templateEnd; r++) {
    if (referencedTemplateSlots.has(r)) continue;
    for (const key of APPLIANCE_INPUT_COLS) {
      if (key === "name") continue;
      sheet.getCell(`${cols[key]}${r}`).value = null;
    }
  }

  for (let r = userStart; r <= table.endRow; r++) {
    if (referencedUserSlots.has(r)) continue;
    for (const key of APPLIANCE_INPUT_COLS) {
      sheet.getCell(`${cols[key]}${r}`).value = null;
    }
  }
}

function writeTableRows(workbook, table, rows, mapRow) {
  const sheet = workbook.getWorksheet(table.sheet);
  const writeKeys = Object.keys(table.columns).filter((k) => k !== "dailyKwh");
  const referencedSlots = new Set();

  for (const row of rows || []) {
    const excelRow = Number(row.excelRow);
    if (
      !Number.isFinite(excelRow) ||
      excelRow < table.startRow ||
      excelRow > table.endRow
    ) {
      console.warn("Table row missing valid excelRow; skipping write:", row);
      continue;
    }

    referencedSlots.add(excelRow);
    const mapped = mapRow(row);
    for (const key of writeKeys) {
      const col = table.columns[key];
      sheet.getCell(`${col}${excelRow}`).value =
        mapped[key] !== undefined ? mapped[key] : null;
    }
  }

  for (let r = table.startRow; r <= table.endRow; r++) {
    if (referencedSlots.has(r)) continue;
    for (const key of writeKeys) {
      sheet.getCell(`${table.columns[key]}${r}`).value = null;
    }
  }
}

const EXCEL_ERROR_NAME_RE = /^#(REF|N\/A|VALUE|DIV\/0|NAME\?|NUM|NULL|GETTING_DATA)!?$/i;

function isUsableApplianceName(name) {
  if (name === null || name === undefined) return false;
  const trimmed = String(name).trim();
  if (!trimmed) return false;
  if (EXCEL_ERROR_NAME_RE.test(trimmed)) return false;
  return true;
}

/**
 * Read Appliance_Input rows. By default scans the full table; pass
 * templateOnly to read formula-driven A4:templateEndRow only.
 */
function readApplianceInputRows(workbook, { templateOnly = false } = {}) {
  const table = APPLIANCE_TABLE;
  const sheet = workbook.getWorksheet(table.sheet);
  const cols = table.columns;
  const end = templateOnly
    ? (table.templateEndRow ?? 20)
    : table.endRow;
  const rows = [];

  for (let r = table.startRow; r <= end; r++) {
    const name = cellValue(sheet.getCell(`${cols.name}${r}`));
    if (!isUsableApplianceName(name)) continue;

    const dutyRaw = cellValue(sheet.getCell(`${cols.dutyCycle}${r}`));
    const dailyRaw = cols.dailyKwh
      ? cellValue(sheet.getCell(`${cols.dailyKwh}${r}`))
      : null;

    rows.push({
      name: String(name).trim(),
      qty: Number(cellValue(sheet.getCell(`${cols.qty}${r}`))) || 0,
      watts: Number(cellValue(sheet.getCell(`${cols.watts}${r}`))) || 0,
      hours: Number(cellValue(sheet.getCell(`${cols.hours}${r}`))) || 0,
      dutyCycle: Number(dutyRaw) || 0,
      dailyKwh: dailyRaw === null || dailyRaw === undefined ? null : Number(dailyRaw) || 0,
      excelRow: r,
      source: r <= (table.templateEndRow ?? 20) ? "template" : "user",
    });
  }

  return rows;
}

function readTableRows(workbook, table) {
  const sheet = workbook.getWorksheet(table.sheet);
  const rows = [];
  const writeKeys = Object.keys(table.columns).filter((k) => k !== "dailyKwh");

  for (let r = table.startRow; r <= table.endRow; r++) {
    const name = cellValue(sheet.getCell(`${table.columns.name}${r}`));
    if (!isUsableApplianceName(name)) continue;

    const row = { name: String(name).trim() };
    for (const key of writeKeys) {
      if (key === "name") continue;
      row[key] = Number(cellValue(sheet.getCell(`${table.columns[key]}${r}`))) || 0;
    }
    rows.push(row);
  }

  return rows;
}

function readOutputs(workbook) {
  const outputs = workbook.getWorksheet(SHEETS.outputs);
  const results = {};

  for (const [key, ref] of Object.entries(OUTPUT_CELLS)) {
    results[key] = cellValue(outputs.getCell(ref));
  }

  const summary = {};
  for (const [method, cells] of Object.entries(SUMMARY_CELLS)) {
    const sheet = workbook.getWorksheet(cells.sheet);
    summary[method] = {};
    for (const [key, ref] of Object.entries(cells)) {
      if (key === "sheet") continue;
      summary[method][key] = cellValue(sheet.getCell(ref));
    }
    const annualLoadRef = ESTIMATED_ANNUAL_LOAD_CELLS[method];
    if (annualLoadRef) {
      summary[method].estimatedAnnualLoadKwh = cellValue(
        outputs.getCell(annualLoadRef),
      );
    }
  }

  // Monthly Bill live-summary card: Outputs!B36
  summary.bill = summary.bill || {};
  summary.bill.estimatedMonthlySpend = cellValue(
    outputs.getCell(OUTPUT_LIVE_SUMMARY_CELLS.estimatedMonthlySpend),
  );

  results.summary = summary;

  return results;
}

/**
 * Per-row Daily_kWh from Appliance_Input!G or Custom_Equipment!G after recalc.
 */
function readDailyKwhByRow(workbook, inputMethod) {
  const table =
    inputMethod === "custom"
      ? CUSTOM_TABLE
      : inputMethod === "appliance"
        ? APPLIANCE_TABLE
        : null;
  if (!table?.columns?.dailyKwh) return [];

  const sheet = workbook.getWorksheet(table.sheet);
  if (!sheet) return [];

  const rows = [];
  for (let r = table.startRow; r <= table.endRow; r++) {
    const raw = cellValue(sheet.getCell(`${table.columns.dailyKwh}${r}`));
    const dailyKwh =
      raw === null || raw === undefined || raw === ""
        ? null
        : Number(raw);
    rows.push({
      excelRow: r,
      dailyKwh: Number.isFinite(dailyKwh) ? dailyKwh : null,
    });
  }
  return rows;
}

function numOr(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function capexByProperty(propertyType, home, office, factory, other) {
  if (propertyType === "Home") return home;
  if (propertyType === "Office") return office;
  if (propertyType === "Factory") return factory;
  return other;
}

/**
 * Derive Outputs financial/sizing/% fields in Node.
 * Used only when Excel COM leaves Outputs caches empty/stale after recalc.
 * Mirrors the *live* workbook formulas (Solar_Sizing / Battery_Sizing /
 * Load_Estimation / Financial_Model / Diesel_Economics), not the older
 * peak-sun daily floor model.
 */
function deriveAssessmentOutputs(workbook, formData) {
  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const billInput = workbook.getWorksheet(SHEETS.billInput);
  const applianceSheet = workbook.getWorksheet(SUMMARY_CELLS.appliance.sheet);
  const customSheet = workbook.getWorksheet(SUMMARY_CELLS.custom.sheet);

  const propertyType =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.propertyType)) ||
    formData.propertyType ||
    "Home";
  const powerSetup =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.powerSetup)) ||
    formData.powerSetup ||
    null;
  const objective =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.mainObjective)) ||
    formData.mainObjective ||
    null;
  const country =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.country)) ||
    formData.country ||
    null;
  const city =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.state)) ||
    formData.city ||
    formData.state ||
    null;
  const scenarioName = cellValue(userInputs.getCell("B5")) || "Base Case";
  const assessmentId = cellValue(userInputs.getCell("B4"));

  const inputMethodLabel =
    cellValue(userInputs.getCell(USER_INPUT_CELLS.inputMethod)) ||
    INPUT_METHOD_LABELS[formData.inputMethod] ||
    "Bill";

  const writtenUsage = numOr(
    cellValue(userInputs.getCell(USER_INPUT_CELLS.monthlyUsageKwh)) ??
      formData.bill?.monthlyUsage,
    0,
  );
  const billMonthly =
    writtenUsage > 0
      ? writtenUsage
      : numOr(cellValue(billInput.getCell("B11")), 0);

  const billingDays = Math.max(numOr(cellValue(billInput.getCell("B8")), 30), 1);

  const dailyKwhFromRows = (rows, { useLoadFactorPct = true } = {}) => {
    if (!Array.isArray(rows) || !rows.length) return 0;
    return rows.reduce((sum, row) => {
      const qty = numOr(row.qty, 0);
      const hours = numOr(row.hours, 0);
      const power = numOr(row.power, 0);
      const duty = useLoadFactorPct
        ? numOr(row.loadFactorPct, 100) / 100
        : numOr(row.dutyCycle, 1);
      return sum + (qty * hours * power * duty) / 1000;
    }, 0);
  };

  const peakKwFromRows = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return 0;
    return rows.reduce(
      (sum, row) => sum + (numOr(row.qty, 0) * numOr(row.power, 0)) / 1000,
      0,
    );
  };

  const applianceDailyFromForm = dailyKwhFromRows(formData.appliance?.rows);
  const customDailyFromForm = dailyKwhFromRows(formData.custom?.rows);

  const applianceMonthlyFromSheet = numOr(
    cellValue(applianceSheet.getCell(SUMMARY_CELLS.appliance.monthlyKwh)),
    0,
  );
  const customMonthlyFromSheet = numOr(
    cellValue(customSheet.getCell(SUMMARY_CELLS.custom.monthlyKwh)),
    0,
  );

  const applianceMonthly =
    applianceDailyFromForm > 0
      ? applianceDailyFromForm * billingDays
      : applianceMonthlyFromSheet;
  const customMonthly =
    customDailyFromForm > 0
      ? customDailyFromForm * billingDays
      : customMonthlyFromSheet;

  let selectedMonthly = billMonthly;
  if (inputMethodLabel === "Appliances") selectedMonthly = applianceMonthly;
  else if (inputMethodLabel === "Custom") selectedMonthly = customMonthly;
  else if (inputMethodLabel !== "Bill") {
    selectedMonthly = Math.max(billMonthly, applianceMonthly, customMonthly);
  }

  // Load_Estimation!B9 = monthly * 12
  const annualLoad = selectedMonthly * 12;
  const billAnnualLoad = billMonthly * 12;
  const applianceAnnualLoad = applianceMonthly * 12;
  const customAnnualLoad = customMonthly * 12;

  const yieldKwhPerKwp = Math.max(numOr(cellValue(userInputs.getCell("B42")), 1450), 1);
  const targetSolarShare = Math.min(
    1,
    numOr(cellValue(userInputs.getCell("B26")), 0.9),
  );

  // Solar_Sizing!B11 = annual_load / yield; B12 = B11 (live template; no ROUND)
  const recommendedSolarKwpRaw =
    annualLoad > 0 ? annualLoad / yieldKwhPerKwp : 0;
  const recommendedSolarKwp = round1(recommendedSolarKwpRaw);

  // Solar_Sizing!B13 / B14 — use unrounded kWp so % impact matches B26 exactly
  const annualPvGenerationKwh = recommendedSolarKwpRaw * yieldKwhPerKwp;
  const usableSolarKwh = annualPvGenerationKwh * targetSolarShare;

  const declaredPeakKw = numOr(cellValue(userInputs.getCell("B19")), 0);
  let estimatedPeakKw = 0;
  if (inputMethodLabel === "Bill") {
    estimatedPeakKw =
      selectedMonthly > 0 ? (selectedMonthly / (30 * 24)) * 3 : 0;
  } else if (inputMethodLabel === "Appliances") {
    estimatedPeakKw =
      peakKwFromRows(formData.appliance?.rows) ||
      numOr(cellValue(applianceSheet.getCell("L6")), 0);
  } else if (inputMethodLabel === "Custom") {
    estimatedPeakKw =
      peakKwFromRows(formData.custom?.rows) ||
      numOr(cellValue(customSheet.getCell("M7")), 0);
  }
  // Load_Estimation!B11
  const peakLoadKw = declaredPeakKw > 0 ? declaredPeakKw : estimatedPeakKw;

  const criticalPct = numOr(cellValue(userInputs.getCell("B24")), 0.6);
  const backupHours = numOr(
    cellValue(userInputs.getCell(USER_INPUT_CELLS.backupDuration)) ??
      formData.backupDuration,
    4,
  );
  const inverterFactor = numOr(cellValue(userInputs.getCell("B44")), 1);
  // Battery_Sizing: criticalPeak * backupHours (B5*B6), floored at 0.5
  const criticalPeakKw = peakLoadKw * criticalPct;
  const recommendedBatteryKwh = round1(
    Math.max(0.5, criticalPeakKw * backupHours),
  );
  const recommendedInverterKw = round1(peakLoadKw * inverterFactor);

  const outageHours = numOr(cellValue(userInputs.getCell("B20")), 6);
  const outageFraction = Math.min(1, outageHours / 24);
  const generatorKwhPerLitre = Math.max(
    numOr(cellValue(userInputs.getCell("B32")), 3.5),
    0.1,
  );
  const gridTariffBase = numOr(
    cellValue(userInputs.getCell(USER_INPUT_CELLS.gridTariff)) ??
      formData.bill?.gridTariff,
    numOr(cellValue(userInputs.getCell("B30")), 0),
  );
  const dieselPrice = numOr(cellValue(userInputs.getCell("B31")), 1200);
  const dieselCostPerKwh = dieselPrice / generatorKwhPerLitre;

  // Diesel_Economics!B7 blended effective tariff
  const effectiveTariff =
    powerSetup === "Grid Only"
      ? gridTariffBase ||
        numOr(cellValue(billInput.getCell("B7")), 200)
      : (gridTariffBase || numOr(cellValue(billInput.getCell("B7")), 200)) *
          (1 - outageFraction) +
        dieselCostPerKwh * outageFraction;

  const usesDieselDisplacement =
    powerSetup === "Grid + Generator" || powerSetup === "Generator Only";
  const dieselSavedLitres = usesDieselDisplacement
    ? (usableSolarKwh * outageFraction) / generatorKwhPerLitre
    : 0;

  const pvCapex = numOr(
    cellValue(userInputs.getCell("B33")),
    capexByProperty(propertyType, 300000, 420000, 320000, 550000),
  );
  const batteryCapex = numOr(
    cellValue(userInputs.getCell("B34")),
    capexByProperty(propertyType, 260000, 350000, 300000, 420000),
  );
  const inverterCapex = numOr(
    cellValue(userInputs.getCell("B35")),
    capexByProperty(propertyType, 230000, 300000, 220000, 380000),
  );
  const bosFactor = numOr(
    cellValue(userInputs.getCell("B36")),
    capexByProperty(propertyType, 0.12, 0.15, 0.12, 0.2),
  );
  const omRate = numOr(cellValue(userInputs.getCell("B37")), 0.02);

  // Financial_Model live: B7=sum of PV+batt+inv, B8=BOS, B9=total
  const pvCost = recommendedSolarKwp * pvCapex;
  const batteryCost = recommendedBatteryKwh * batteryCapex;
  const inverterCost = recommendedInverterKw * inverterCapex;
  const equipmentSubtotal = pvCost + batteryCost + inverterCost;
  const bosCost = equipmentSubtotal * bosFactor;
  const estimatedSystemCost = equipmentSubtotal + bosCost;
  // Financial_Model!B10 = Solar_Sizing!B14 * Diesel_Economics!B7
  const grossAnnualSavings = usableSolarKwh * effectiveTariff;
  const annualOmAllowance = estimatedSystemCost * omRate;
  const netAnnualSavings = grossAnnualSavings - annualOmAllowance;
  const simplePaybackYears =
    netAnnualSavings > 0 ? estimatedSystemCost / netAnnualSavings : null;

  // Outputs B27–B29 use annual usable / annual load
  const solarShare = annualLoad > 0 ? usableSolarKwh / annualLoad : null;
  const gridOffset =
    annualLoad > 0
      ? (usableSolarKwh * (1 - outageFraction)) / annualLoad
      : null;
  const dieselReduction =
    annualLoad > 0 ? (usableSolarKwh * outageFraction) / annualLoad : null;

  // Chart costs: Grid = B30, Diesel = Diesel_Economics!B6, Solar LCOE = B9/(B14*B39)
  const systemLifeYears = Math.max(
    numOr(cellValue(userInputs.getCell("B39")), 15),
    1,
  );
  const gridCostPerKwh =
    gridTariffBase > 0
      ? gridTariffBase
      : numOr(cellValue(billInput.getCell("B7")), 0) || null;
  const solarCostPerKwh =
    usableSolarKwh > 0 && estimatedSystemCost > 0
      ? estimatedSystemCost / (usableSolarKwh * systemLifeYears)
      : null;

  let leadType = "Review";
  if (simplePaybackYears !== null) {
    if (simplePaybackYears <= 5) leadType = "Hot";
    else if (simplePaybackYears <= 8) leadType = "Warm";
    else leadType = "Nurture";
  }
  const recommendedNextStep =
    leadType === "Hot"
      ? "Book installer intro"
      : leadType === "Warm"
        ? "Request expert review"
        : "Download report and revisit";

  const primaryRecommendation =
    objective === "Reduce Electricity Bills"
      ? "Prioritise bill reduction with daytime solar offset"
      : objective === "Reduce Diesel Use"
        ? "Prioritise diesel displacement with hybrid solar + storage"
        : objective === "Backup During Outages"
          ? "Prioritise backup autonomy with battery-first sizing"
          : "Review objective mapping";

  const roofAreaValue = numOr(
    cellValue(userInputs.getCell(USER_INPUT_CELLS.roofArea)),
    0,
  );
  const confidenceNote =
    roofAreaValue === 0 || selectedMonthly === 0
      ? "Preliminary estimate based on partial inputs"
      : "Preliminary estimate with user-supplied site context";

  return {
    assessmentId,
    scenarioName,
    country,
    city,
    propertyType,
    powerSetup,
    objective,
    recommendedSolarKwp,
    recommendedBatteryKwh,
    recommendedInverterKw,
    annualPvGenerationKwh: round1(annualPvGenerationKwh),
    usableSolarKwh: round1(usableSolarKwh),
    estimatedSystemCost: Math.round(estimatedSystemCost),
    grossAnnualSavings: Math.round(grossAnnualSavings),
    annualOmAllowance: Math.round(annualOmAllowance),
    netAnnualSavings: Math.round(netAnnualSavings),
    simplePaybackYears:
      simplePaybackYears === null ? null : round1(simplePaybackYears),
    dieselSavedLitres: round1(dieselSavedLitres),
    leadType,
    recommendedNextStep,
    primaryRecommendation,
    confidenceNote,
    solarShare,
    gridOffset,
    dieselReduction,
    gridCostPerKwh:
      gridCostPerKwh === null || gridCostPerKwh === 0
        ? null
        : round1(gridCostPerKwh),
    dieselCostPerKwh: round1(dieselCostPerKwh),
    solarCostPerKwh:
      solarCostPerKwh === null ? null : round1(solarCostPerKwh),
    summary: {
      bill: {
        monthlyUsage: billMonthly || null,
        estimatedAnnualLoadKwh: billAnnualLoad || null,
      },
      appliance: {
        dailyKwh:
          applianceDailyFromForm > 0
            ? round1(applianceDailyFromForm)
            : numOr(
                cellValue(
                  applianceSheet.getCell(SUMMARY_CELLS.appliance.dailyKwh),
                ),
                null,
              ),
        monthlyKwh: applianceMonthly || null,
        estimatedAnnualLoadKwh: applianceAnnualLoad || null,
      },
      custom: {
        dailyKwh:
          customDailyFromForm > 0
            ? round1(customDailyFromForm)
            : numOr(
                cellValue(customSheet.getCell(SUMMARY_CELLS.custom.dailyKwh)),
                null,
              ),
        monthlyKwh: customMonthly || null,
        estimatedAnnualLoadKwh: customAnnualLoad || null,
      },
    },
  };
}

function isUsableSheetValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/** Keys where Excel Outputs is preferred when COM cache is fresh. */
const SHEET_PREFERRED_OUTPUT_KEYS = new Set([
  "recommendedSolarKwp",
  "recommendedBatteryKwh",
  "recommendedInverterKw",
  "annualPvGenerationKwh",
  "usableSolarKwh",
  "estimatedSystemCost",
  "grossAnnualSavings",
  "annualOmAllowance",
  "netAnnualSavings",
  "simplePaybackYears",
  "dieselSavedLitres",
  "solarShare",
  "gridOffset",
  "dieselReduction",
  "leadType",
  "recommendedNextStep",
  "primaryRecommendation",
  "confidenceNote",
  "disclaimer",
]);

/**
 * True when Outputs sizing looks consistent with Node's Excel-aligned model
 * for the same inputs (guards against stale COM formula caches).
 */
function sheetSizingLooksFresh(sheetResults, derived) {
  const sheetKwp = Number(sheetResults?.recommendedSolarKwp);
  const derivedKwp = Number(derived?.recommendedSolarKwp);
  if (!Number.isFinite(sheetKwp) || !Number.isFinite(derivedKwp)) return false;
  if (derivedKwp <= 0) return sheetKwp <= 0;
  const rel = Math.abs(sheetKwp - derivedKwp) / Math.max(derivedKwp, 0.1);
  return rel <= 0.2;
}

/**
 * Prefer live Outputs sheet values after COM recalc when they look fresh.
 * Otherwise use Node derivation (aligned to live Excel formulas) so stale
 * template caches cannot win over the written assessment inputs.
 */
function mergeOutputResults(sheetResults, derived) {
  const merged = { ...sheetResults };
  const trustSheet = sheetSizingLooksFresh(sheetResults, derived);

  for (const [key, value] of Object.entries(derived)) {
    if (key === "summary") {
      merged.summary = {
        ...(sheetResults.summary || {}),
        bill: {
          ...(sheetResults.summary?.bill || {}),
          ...(value.bill || {}),
        },
        appliance: {
          ...(sheetResults.summary?.appliance || {}),
          ...(value.appliance || {}),
        },
        custom: {
          ...(sheetResults.summary?.custom || {}),
          ...(value.custom || {}),
        },
      };
      continue;
    }

    const sheetHasValue = isUsableSheetValue(merged[key]);
    const derivedHasValue =
      value !== null && value !== undefined && value !== "";

    if (SHEET_PREFERRED_OUTPUT_KEYS.has(key)) {
      if (trustSheet && sheetHasValue) continue;
      if (derivedHasValue) merged[key] = value;
      continue;
    }

    // Metadata (country, propertyType, …): prefer sheet when present.
    if (sheetHasValue) continue;
    if (derivedHasValue) merged[key] = value;
  }

  if (!trustSheet && process.env.NODE_ENV !== "production") {
    console.warn(
      "Excel Outputs cache looks stale vs inputs; using Excel-aligned Node derivation for sizing/financial/% fields.",
    );
  }

  return merged;
}

function verifyWrittenInputs(workbook, formData) {
  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const expectedProperty = formData.propertyType;
  const actualProperty = cellValue(
    userInputs.getCell(USER_INPUT_CELLS.propertyType),
  );
  const expectedUsage = toNumber(formData.bill?.monthlyUsage);
  const actualUsage = cellValue(
    userInputs.getCell(USER_INPUT_CELLS.monthlyUsageKwh),
  );

  if (expectedProperty && actualProperty !== expectedProperty) {
    console.warn(
      `Excel write verify: propertyType expected "${expectedProperty}" got "${actualProperty}"`,
    );
  }
  if (
    formData.inputMethod === "bill" &&
    expectedUsage !== null &&
    Number(actualUsage) !== expectedUsage
  ) {
    console.warn(
      `Excel write verify: monthlyUsage expected ${expectedUsage} got ${actualUsage}`,
    );
  }
}

/**
 * Match UI template dropdown labels to Appliance_Library!B names.
 * Library often stores "2-Bedroom Flat - Standard" while the dropdown is "2-Bedroom Flat".
 */
function libraryTemplateMatches(libraryName, selectedTemplate) {
  const lib = String(libraryName ?? "")
    .trim()
    .toLowerCase();
  const selected = String(selectedTemplate ?? "")
    .trim()
    .toLowerCase();
  if (!lib || !selected) return false;
  if (lib === selected) return true;
  if (lib.startsWith(`${selected} -`)) return true;
  if (lib.startsWith(`${selected} `)) return true;
  return false;
}

/**
 * Read template appliances from Appliance_Library (static values).
 * Avoids INDEX/CHOOSE formulas that LibreOffice often fails to cache for ExcelJS.
 */
async function readTemplateAppliancesFromLibrary(propertyType, template) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(getTemplatePath());
  const sheet = workbook.getWorksheet(SHEETS.applianceLibrary);
  if (!sheet) {
    throw new Error("Appliance_Library sheet not found in Excel template");
  }

  const property = String(propertyType ?? "").trim();
  const selected = String(template ?? "").trim();
  const groups = new Map();

  for (let r = 4; r <= 500; r++) {
    const category = cellValue(sheet.getCell(`A${r}`));
    const templateName = cellValue(sheet.getCell(`B${r}`));
    const equipment = cellValue(sheet.getCell(`D${r}`));

    if (
      (category === null || String(category).trim() === "") &&
      (templateName === null || String(templateName).trim() === "") &&
      (equipment === null || String(equipment).trim() === "")
    ) {
      continue;
    }

    if (String(category ?? "").trim() !== property) continue;
    if (!libraryTemplateMatches(templateName, selected)) continue;

    const key = String(templateName).trim();
    if (!groups.has(key)) groups.set(key, []);

    const name = String(equipment ?? "").trim();
    if (!isUsableApplianceName(name)) continue;

    const qty = Number(cellValue(sheet.getCell(`E${r}`))) || 0;
    const watts = Number(cellValue(sheet.getCell(`F${r}`))) || 0;
    const hours = Number(cellValue(sheet.getCell(`G${r}`))) || 0;
    const dutyCycle = Number(cellValue(sheet.getCell(`H${r}`)));
    const duty = Number.isFinite(dutyCycle) ? dutyCycle : 1;
    const dailyKwh = (qty * watts * hours * duty) / 1000;

    groups.get(key).push({
      name,
      qty,
      watts,
      hours,
      dutyCycle: duty,
      dailyKwh,
    });
  }

  if (groups.size === 0) {
    return [];
  }

  // Prefer exact library name match, otherwise first matched group.
  const exactKey = [...groups.keys()].find(
    (key) => key.toLowerCase() === selected.toLowerCase(),
  );
  const chosenKey = exactKey || groups.keys().next().value;
  const templateEnd = APPLIANCE_TABLE.templateEndRow ?? 20;
  const start = APPLIANCE_TABLE.startRow;

  return groups.get(chosenKey).slice(0, templateEnd - start + 1).map((row, i) => ({
    ...row,
    excelRow: start + i,
    source: "template",
  }));
}

/**
 * Prefill flow: read Appliance_Library rows for the selected property/template.
 * Does not depend on Excel/LibreOffice recalculating INDEX/CHOOSE into Appliance_Input.
 */
export async function getTemplatePrefill(propertyType, template) {
  const applianceRows = await readTemplateAppliancesFromLibrary(
    propertyType,
    template,
  );

  const dailyKwhRaw = applianceRows.reduce(
    (sum, row) => sum + (Number(row.dailyKwh) || 0),
    0,
  );
  const dailyKwh = Math.round(dailyKwhRaw * 1e6) / 1e6;
  const monthlyKwh = Math.round(dailyKwh * 30 * 1e6) / 1e6;

  return {
    applianceRows: applianceRows.map((row) => ({
      ...row,
      dailyKwh: Math.round((Number(row.dailyKwh) || 0) * 1e6) / 1e6,
    })),
    summary: {
      dailyKwh,
      monthlyKwh,
    },
  };
}

/**
 * Full calculation flow: write all inputs, recalculate, read Outputs sheet.
 * Results come from Excel only — no Node sizing/financial derivation.
 *
 * Windows/COM: copy template → COM writes inputs + recalcs (ExcelJS writes
 * produce workbooks COM often cannot open).
 * LibreOffice: ExcelJS writeInputs → soffice recalc → read.
 */
export async function calculateAssessment(formData) {
  const templatePath = getTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Excel template not found: ${templatePath}`);
  }

  const useComDirect = useComDirectWrites();

  async function runOnce() {
    const workPath = newWorkPath("assessment");
    let recalc = null;
    try {
      fs.copyFileSync(templatePath, workPath);

      if (!useComDirect) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(workPath);
        writeInputs(workbook, formData);
        verifyWrittenInputs(workbook, formData);
        await workbook.xlsx.writeFile(workPath);
      }

      recalc = await recalculateWorkbook(workPath, formData);

      const result = new ExcelJS.Workbook();
      await result.xlsx.readFile(recalc.outPath);
      const loadCheck = assertLoadEstimationMatches(result, formData);
      const backupCheck = assertBackupDurationMatches(result, formData);
      const freshness = {
        ok: loadCheck.ok && backupCheck.ok,
        reason: !loadCheck.ok
          ? loadCheck.reason
          : !backupCheck.ok
            ? backupCheck.reason
            : "ok",
        loadCheck,
        backupCheck,
      };
      const sheetResults = readOutputs(result);
      sheetResults.rowDailyKwh = readDailyKwhByRow(
        result,
        formData.inputMethod,
      );

      return { workPath, recalc, result, freshness, sheetResults };
    } catch (error) {
      safeUnlink(workPath);
      if (recalc) safeUnlink(recalc.cleanupDir);
      throw error;
    }
  }

  let pass = await runOnce();
  try {
    if (!pass.freshness.ok) {
      console.warn(
        `Excel Outputs stale after recalc (${pass.freshness.reason}); retrying with fresh template…`,
      );
      safeUnlink(pass.workPath);
      if (pass.recalc) safeUnlink(pass.recalc.cleanupDir);
      pass = await runOnce();
      if (!pass.freshness.ok) {
        throw new Error(
          `Excel Outputs are stale after recalculation: ${pass.freshness.reason}. Close Excel if the template is open and try again.`,
        );
      }
    }

    if (process.env.EXCEL_DERIVE_DEBUG === "1") {
      const derived = deriveAssessmentOutputs(pass.result, formData);
      console.log(
        "[EXCEL_DERIVE_DEBUG] sheet vs derived solar kWp:",
        pass.sheetResults.recommendedSolarKwp,
        derived.recommendedSolarKwp,
      );
    }

    return pass.sheetResults;
  } finally {
    safeUnlink(pass.workPath);
    if (pass.recalc) safeUnlink(pass.recalc.cleanupDir);
  }
}

/**
 * Live assessment summary: recalculate workbook and read Outputs summary
 * cells, including estimated annual load (B34 / B41 / B46 by input method).
 */
export async function getLiveSummary(formData) {
  const results = await calculateAssessment(formData);
  const method = formData.inputMethod || "bill";
  const methodSummary = results.summary?.[method] || {};
  const billSummary = results.summary?.bill || {};

  return {
    inputMethod: method,
    estimatedAnnualLoadKwh: methodSummary.estimatedAnnualLoadKwh ?? null,
    estimatedMonthlySpend:
      method === "bill"
        ? (billSummary.estimatedMonthlySpend ?? null)
        : null,
    summary: results.summary,
    rowDailyKwh: Array.isArray(results.rowDailyKwh) ? results.rowDailyKwh : [],
  };
}

/**
 * Expected monthly kWh for the selected input method (for COM freshness checks).
 */
function expectedMonthlyUsage(formData) {
  const method = formData.inputMethod;
  if (method === "bill") {
    return toNumber(formData.bill?.monthlyUsage) ?? 0;
  }
  if (method === "appliance") {
    const rows = formData.appliance?.rows || [];
    const daily = rows.reduce((sum, row) => {
      const qty = Number(row.qty) || 0;
      const hours = Number(row.hours) || 0;
      const power = Number(row.power) || 0;
      const duty = (Number(row.loadFactorPct) || 100) / 100;
      return sum + (qty * hours * power * duty) / 1000;
    }, 0);
    return daily * 30;
  }
  if (method === "custom") {
    const rows = formData.custom?.rows || [];
    const daily = rows.reduce((sum, row) => {
      if (row.removed) return sum;
      const qty = Number(row.qty) || 0;
      const hours = Number(row.hours) || 0;
      const power = Number(row.power) || 0;
      // Custom_Equipment Load_Factor is 0–100 (same as UI), not a 0–1 fraction.
      const loadFactor = Number(row.loadFactorPct) || 0;
      return sum + (qty * hours * power * loadFactor) / 1000;
    }, 0);
    return daily * 30;
  }
  return 0;
}

/**
 * After COM/LibreOffice recalc, verify Load_Estimation reflects written inputs.
 * Prevents saving stale template Outputs as assessment results.
 */
function assertLoadEstimationMatches(workbook, formData) {
  const loadSheet = workbook.getWorksheet("Load_Estimation");
  if (!loadSheet) {
    return { ok: false, reason: "Load_Estimation sheet missing" };
  }

  const methodLabel =
    INPUT_METHOD_LABELS[formData.inputMethod] || formData.inputMethod;
  const sheetMethod = cellValue(loadSheet.getCell("B4"));
  const sheetMonthly = Number(cellValue(loadSheet.getCell("B8")));
  const expectedMonthly = expectedMonthlyUsage(formData);

  if (
    methodLabel &&
    sheetMethod &&
    String(sheetMethod).trim().toLowerCase() !==
      String(methodLabel).trim().toLowerCase()
  ) {
    return {
      ok: false,
      reason: `method sheet="${sheetMethod}" expected="${methodLabel}"`,
    };
  }

  if (
    expectedMonthly > 0 &&
    Number.isFinite(sheetMonthly) &&
    Math.abs(sheetMonthly - expectedMonthly) / Math.max(expectedMonthly, 1) >
      0.25
  ) {
    return {
      ok: false,
      reason: `monthly sheet=${sheetMonthly} expected≈${expectedMonthly}`,
    };
  }

  if (expectedMonthly > 0 && !(sheetMonthly > 0)) {
    return {
      ok: false,
      reason: `monthly sheet empty/zero expected≈${expectedMonthly}`,
    };
  }

  return { ok: true, reason: "ok", sheetMethod, sheetMonthly };
}

/**
 * Verify backup hours landed in User_Inputs!B25 and Battery_Sizing!B6.
 * Stale B25=4 (template default) was the root cause of wrong battery/cost/payback.
 */
function assertBackupDurationMatches(workbook, formData) {
  const expected = toNumber(formData.backupDuration);
  if (expected === null) {
    return { ok: true, reason: "no backupDuration provided" };
  }

  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const batterySheet = workbook.getWorksheet("Battery_Sizing");
  if (!userInputs) {
    return { ok: false, reason: "User_Inputs sheet missing" };
  }

  const b25 = Number(
    cellValue(userInputs.getCell(USER_INPUT_CELLS.backupDuration)),
  );
  const b6 = batterySheet
    ? Number(cellValue(batterySheet.getCell("B6")))
    : NaN;

  if (Number.isFinite(b25) && Math.abs(b25 - expected) > 0.01) {
    return {
      ok: false,
      reason: `backupDuration User_Inputs!B25=${b25} expected=${expected}`,
    };
  }

  if (Number.isFinite(b6) && Math.abs(b6 - expected) > 0.01) {
    return {
      ok: false,
      reason: `backupDuration Battery_Sizing!B6=${b6} expected=${expected}`,
    };
  }

  if (!Number.isFinite(b25) && !Number.isFinite(b6)) {
    return {
      ok: false,
      reason: `backupDuration missing expected=${expected}`,
    };
  }

  return { ok: true, reason: "ok", b25, b6, expected };
}

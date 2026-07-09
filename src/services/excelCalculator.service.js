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

function libreOfficeAvailable() {
  const configured = getLibreOfficePath();
  if (configured !== "soffice" && fs.existsSync(configured)) {
    return true;
  }
  // Default "soffice" — only trust if the standard Windows path exists
  return fs.existsSync("C:\\Program Files\\LibreOffice\\program\\soffice.com");
}

function excelComAvailable() {
  if (process.platform !== "win32") return false;
  if (process.env.EXCEL_USE_COM === "false") return false;
  return WINDOWS_EXCEL_PATHS.some((p) => fs.existsSync(p));
}

/** Recalculate in-place via Microsoft Excel COM (Windows local dev). */
async function recalculateWithExcelCom(inputPath) {
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      EXCEL_COM_SCRIPT,
      "-InputPath",
      inputPath,
    ],
    { timeout: getCalcTimeoutMs(), windowsHide: true },
  );
  return { outPath: inputPath, cleanupDir: null };
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

  try {
    await execFileAsync(
      getLibreOfficePath(),
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
      getLibreOfficePath(),
      ["--headless", "--norestore", "--convert-to", "xlsx", "--outdir", outDir, inputPath],
      { timeout: getCalcTimeoutMs(), windowsHide: true },
    );
  }

  const outPath = path.join(outDir, path.basename(inputPath));
  if (!fs.existsSync(outPath)) {
    throw new Error("LibreOffice did not produce a recalculated workbook");
  }
  return { outPath, cleanupDir: outDir };
}

/** Pick LibreOffice on server, Excel COM on Windows dev when LibreOffice is missing. */
async function recalculateWorkbook(inputPath) {
  if (libreOfficeAvailable()) {
    return recalculateWithLibreOffice(inputPath);
  }
  if (excelComAvailable()) {
    console.log("Using Microsoft Excel COM for local recalculation");
    return recalculateWithExcelCom(inputPath);
  }
  throw new Error(
    "No Excel recalculation engine found. Install LibreOffice (npm run setup:local) or use Windows with Microsoft Excel.",
  );
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
    writeTableRows(workbook, APPLIANCE_TABLE, formData.appliance.rows, (row) => ({
      name: row.kind,
      qty: Number(row.qty) || 0,
      watts: Number(row.power) || 0,
      hours: Number(row.hours) || 0,
      dutyCycle:
        row.dutyCycle !== undefined
          ? Number(row.dutyCycle) || 1
          : (Number(row.loadFactorPct) || 100) / 100,
    }));
  }

  if (formData.inputMethod === "custom" && formData.custom?.rows) {
    writeTableRows(workbook, CUSTOM_TABLE, formData.custom.rows, (row) => ({
      name: row.kind,
      watts: Number(row.power) || 0,
      loadFactor: (Number(row.loadFactorPct) || 100) / 100,
      qty: Number(row.qty) || 0,
      hours: Number(row.hours) || 0,
    }));
  }
}

function writeTableRows(workbook, table, rows, mapRow) {
  const sheet = workbook.getWorksheet(table.sheet);
  const maxRows = table.endRow - table.startRow + 1;
  const limited = rows.slice(0, maxRows);

  for (let i = 0; i < maxRows; i++) {
    const excelRow = table.startRow + i;
    if (i < limited.length) {
      const mapped = mapRow(limited[i]);
      for (const [key, col] of Object.entries(table.columns)) {
        sheet.getCell(`${col}${excelRow}`).value =
          mapped[key] !== undefined ? mapped[key] : null;
      }
    } else {
      // Clear leftover template prefill rows so they don't affect totals
      for (const col of Object.values(table.columns)) {
        sheet.getCell(`${col}${excelRow}`).value = null;
      }
    }
  }
}

function readTableRows(workbook, table) {
  const sheet = workbook.getWorksheet(table.sheet);
  const rows = [];

  for (let r = table.startRow; r <= table.endRow; r++) {
    const name = cellValue(sheet.getCell(`${table.columns.name}${r}`));
    if (name === null || String(name).trim() === "") continue;

    const row = { name: String(name).trim() };
    for (const [key, col] of Object.entries(table.columns)) {
      if (key === "name") continue;
      row[key] = Number(cellValue(sheet.getCell(`${col}${r}`))) || 0;
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
  }
  results.summary = summary;

  return results;
}

/**
 * Prefill flow: write property type + template, recalculate, read the
 * Appliance_Input rows the client's CHOOSE/INDEX formulas produce.
 */
export async function getTemplatePrefill(propertyType, template) {
  const workPath = newWorkPath("prefill");
  let recalc = null;

  try {
    fs.copyFileSync(getTemplatePath(), workPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workPath);

    const userInputs = workbook.getWorksheet(SHEETS.userInputs);
    setCell(userInputs, USER_INPUT_CELLS.propertyType, propertyType);
    setCell(userInputs, USER_INPUT_CELLS.template, template);
    await workbook.xlsx.writeFile(workPath);

    recalc = await recalculateWorkbook(workPath);

    const result = new ExcelJS.Workbook();
    await result.xlsx.readFile(recalc.outPath);

    return {
      applianceRows: readTableRows(result, APPLIANCE_TABLE),
      summary: {
        dailyKwh: cellValue(
          result
            .getWorksheet(SUMMARY_CELLS.appliance.sheet)
            .getCell(SUMMARY_CELLS.appliance.dailyKwh),
        ),
        monthlyKwh: cellValue(
          result
            .getWorksheet(SUMMARY_CELLS.appliance.sheet)
            .getCell(SUMMARY_CELLS.appliance.monthlyKwh),
        ),
      },
    };
  } finally {
    safeUnlink(workPath);
    if (recalc) safeUnlink(recalc.cleanupDir);
  }
}

/**
 * Full calculation flow: write all inputs, recalculate, read Outputs sheet.
 */
export async function calculateAssessment(formData) {
  const workPath = newWorkPath("assessment");
  let recalc = null;

  try {
    fs.copyFileSync(getTemplatePath(), workPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workPath);
    writeInputs(workbook, formData);
    await workbook.xlsx.writeFile(workPath);

    recalc = await recalculateWorkbook(workPath);

    const result = new ExcelJS.Workbook();
    await result.xlsx.readFile(recalc.outPath);

    return readOutputs(result);
  } finally {
    safeUnlink(workPath);
    if (recalc) safeUnlink(recalc.cleanupDir);
  }
}

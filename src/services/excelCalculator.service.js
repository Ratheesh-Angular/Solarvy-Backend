import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  STRATEGY_COMPARISON,
} from "../config/excelMapping.js";
import { cellValue } from "./excelReader.service.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function excelDebugEnabled() {
  return process.env.EXCEL_DEBUG === "1";
}

function excelDebugLog(...args) {
  if (excelDebugEnabled()) console.log(...args);
}

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

function logLibreOfficeExec(label, soffice, args, result, error = null) {
  if (!excelDebugEnabled()) {
    if (error) {
      console.warn(
        `[excel-debug] LibreOffice ${label}: ${error.message || error}`,
      );
    }
    return;
  }
  const stdout = result?.stdout ? String(result.stdout).trim() : "";
  const stderr = result?.stderr ? String(result.stderr).trim() : "";
  console.log(`[excel-debug] LibreOffice ${label}`);
  console.log(`[excel-debug] soffice=${soffice}`);
  console.log(`[excel-debug] args=${JSON.stringify(args)}`);
  if (stdout) console.log(`[excel-debug] stdout=${stdout}`);
  if (stderr) console.warn(`[excel-debug] stderr=${stderr}`);
  if (error) {
    console.warn(
      `[excel-debug] exec error: ${error.message || error}${
        error.code != null ? ` code=${error.code}` : ""
      }`,
    );
  }
}

const LIBREOFFICE_FORCE_XLSX =
  'xlsx:Calc MS Excel 2007 XML:{"RecalcOptions":{"type":"string","value":"force"}}';

function findConvertedFile(outDir, sourcePath, ext) {
  const expected = path.join(outDir, `${path.parse(sourcePath).name}.${ext}`);
  if (fs.existsSync(expected)) return expected;
  if (!fs.existsSync(outDir)) return null;
  const match = fs
    .readdirSync(outDir)
    .find((name) => name.toLowerCase().endsWith(`.${ext}`));
  return match ? path.join(outDir, match) : null;
}

async function execSoffice(soffice, extraArgs, profileDir) {
  const args = [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    "--headless",
    "--norestore",
    "--nologo",
    "--nolockcheck",
    ...extraArgs,
  ];
  const env = { ...process.env };
  if (process.platform !== "win32") {
    env.SAL_USE_VCLPLUGIN = env.SAL_USE_VCLPLUGIN || "svp";
  }
  const result = await execFileAsync(soffice, args, {
    timeout: getCalcTimeoutMs(),
    windowsHide: true,
    env,
  });
  return { args, result };
}

async function convertWithLibreOffice(
  soffice,
  profileDir,
  inputPath,
  convertTo,
  outDir,
) {
  fs.mkdirSync(outDir, { recursive: true });
  const extraArgs = ["--convert-to", convertTo, "--outdir", outDir, inputPath];
  const ext = String(convertTo).split(":")[0].toLowerCase();
  try {
    const { args, result } = await execSoffice(soffice, extraArgs, profileDir);
    logLibreOfficeExec(`convert ${ext} ok`, soffice, args, result);
  } catch (error) {
    logLibreOfficeExec(
      `convert ${ext} failed`,
      soffice,
      extraArgs,
      { stdout: error.stdout, stderr: error.stderr },
      error,
    );
    throw error;
  }
  const outPath = findConvertedFile(outDir, inputPath, ext);
  if (!outPath) {
    throw new Error(
      `LibreOffice did not produce a .${ext} file from ${path.basename(inputPath)}`,
    );
  }
  return outPath;
}

/**
 * Recalculate a workbook with LibreOffice headless (production / Linux EC2).
 * Isolated UserInstallation avoids profile-lock hangs under concurrent assessments.
 * ODS round-trip forces a full Calc rebuild when cached xlsx results stay stale.
 */
async function recalculateWithLibreOffice(
  inputPath,
  { odsRoundtrip = false } = {},
) {
  const soffice = resolveLibreOfficePath();
  const sessionDir = path.join(
    ensureTempDir(),
    `lo-${crypto.randomUUID().slice(0, 8)}`,
  );
  fs.mkdirSync(sessionDir, { recursive: true });
  const profileDir = path.join(sessionDir, "profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const outDir = path.join(sessionDir, "out");
  fs.mkdirSync(outDir, { recursive: true });

  excelDebugLog(
    `[excel-debug] LibreOffice recalc start input=${inputPath} session=${sessionDir} odsRoundtrip=${odsRoundtrip} timeoutMs=${getCalcTimeoutMs()}`,
  );

  try {
    let sourcePath = inputPath;
    if (odsRoundtrip) {
      const odsDir = path.join(sessionDir, "ods");
      sourcePath = await convertWithLibreOffice(
        soffice,
        profileDir,
        inputPath,
        "ods",
        odsDir,
      );
    }

    let outPath;
    try {
      outPath = await convertWithLibreOffice(
        soffice,
        profileDir,
        sourcePath,
        LIBREOFFICE_FORCE_XLSX,
        outDir,
      );
    } catch (forceError) {
      if (!odsRoundtrip) {
        const odsDir = path.join(sessionDir, "ods-fallback");
        const odsPath = await convertWithLibreOffice(
          soffice,
          profileDir,
          inputPath,
          "ods",
          odsDir,
        );
        try {
          outPath = await convertWithLibreOffice(
            soffice,
            profileDir,
            odsPath,
            LIBREOFFICE_FORCE_XLSX,
            outDir,
          );
        } catch {
          outPath = await convertWithLibreOffice(
            soffice,
            profileDir,
            odsPath,
            "xlsx",
            outDir,
          );
        }
      } else {
        outPath = await convertWithLibreOffice(
          soffice,
          profileDir,
          sourcePath,
          "xlsx",
          outDir,
        );
      }
      excelDebugLog(
        `[excel-debug] LibreOffice force-recalc failed (${forceError.message || forceError}); used fallback out=${outPath}`,
      );
    }

    const outSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    excelDebugLog(
      `[excel-debug] LibreOffice outPath=${outPath} exists=${fs.existsSync(outPath)} size=${outSize}`,
    );
    if (!fs.existsSync(outPath)) {
      throw new Error("LibreOffice did not produce a recalculated workbook");
    }
    return { outPath, cleanupDir: sessionDir };
  } catch (error) {
    safeUnlink(sessionDir);
    throw error;
  }
}

/** Prefer Excel COM on Windows (matches desktop Excel); LibreOffice is fallback. */
async function recalculateWorkbook(
  inputPath,
  formData = null,
  { odsRoundtrip = false } = {},
) {
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
    console.log(
      `Using LibreOffice for recalculation (path=${resolveLibreOfficePath()} odsRoundtrip=${odsRoundtrip})`,
    );
    return recalculateWithLibreOffice(inputPath, { odsRoundtrip });
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
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  sheet.getCell(ref).value = value;
}

function clearCellValidation(sheet, ref) {
  try {
    sheet.getCell(ref).dataValidation = undefined;
  } catch {
    // ignore
  }
  try {
    const model = sheet.dataValidations?.model;
    if (model) {
      delete model[ref];
      delete model[String(ref).toUpperCase()];
    }
  } catch {
    // ignore
  }
}

/** Match COM: drop dropdown validation on B25 so backup hours actually stick. */
function writeBackupDuration(sheet, hours) {
  const n = toNumber(hours);
  if (n === null) return;
  clearCellValidation(sheet, USER_INPUT_CELLS.backupDuration);
  sheet.getCell(USER_INPUT_CELLS.backupDuration).value = n;
}

/**
 * Drop cached formula results so LibreOffice cannot reuse stale template values.
 * fullCalcOnLoad asks Calc/Excel to recompute on open.
 */
function stripCachedFormulaResults(workbook) {
  workbook.calcProperties = workbook.calcProperties || {};
  workbook.calcProperties.fullCalcOnLoad = true;

  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (!v || typeof v !== "object") return;
        const formula = v.formula ?? v.sharedFormula ?? cell.formula;
        if (!formula) return;
        if (!Object.prototype.hasOwnProperty.call(v, "result")) return;
        const next = { ...v };
        delete next.result;
        cell.value = next;
      });
    });
  });
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
  writeBackupDuration(userInputs, formData.backupDuration);

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

function readApplianceInputRowAt(sheet, excelRow) {
  const cols = APPLIANCE_TABLE.columns;
  const name = cellValue(sheet.getCell(`${cols.name}${excelRow}`));
  if (!isUsableApplianceName(name)) return null;

  const dutyRaw = cellValue(sheet.getCell(`${cols.dutyCycle}${excelRow}`));
  const dailyRaw = cols.dailyKwh
    ? cellValue(sheet.getCell(`${cols.dailyKwh}${excelRow}`))
    : null;
  const templateEnd = APPLIANCE_TABLE.templateEndRow ?? 20;

  return {
    name: String(name).trim(),
    qty: Number(cellValue(sheet.getCell(`${cols.qty}${excelRow}`))) || 0,
    watts: Number(cellValue(sheet.getCell(`${cols.watts}${excelRow}`))) || 0,
    hours: Number(cellValue(sheet.getCell(`${cols.hours}${excelRow}`))) || 0,
    dutyCycle: Number(dutyRaw) || 0,
    dailyKwh:
      dailyRaw === null || dailyRaw === undefined ? null : Number(dailyRaw) || 0,
    excelRow,
    source: excelRow <= templateEnd ? "template" : "user",
  };
}

/**
 * Read Appliance_Input rows. By default scans the full table; pass
 * templateOnly to read formula-driven A4:templateEndRow only.
 * Blank names and Excel errors (#REF!, etc.) are skipped.
 */
function readApplianceInputRows(workbook, { templateOnly = false } = {}) {
  const table = APPLIANCE_TABLE;
  const sheet = workbook.getWorksheet(table.sheet);
  if (!sheet) return [];
  const end = templateOnly
    ? (table.templateEndRow ?? 20)
    : table.endRow;
  const rows = [];

  for (let r = table.startRow; r <= end; r++) {
    const row = readApplianceInputRowAt(sheet, r);
    if (row) rows.push(row);
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

  // Monthly Bill live-summary cards: Outputs!B36 spend, Outputs!B40 monthly energy
  summary.bill = summary.bill || {};
  summary.bill.estimatedMonthlySpend = cellValue(
    outputs.getCell(OUTPUT_LIVE_SUMMARY_CELLS.estimatedMonthlySpend),
  );
  summary.bill.estimatedMonthlyEnergyKwh = cellValue(
    outputs.getCell(OUTPUT_LIVE_SUMMARY_CELLS.monthlyEnergy),
  );

  results.summary = summary;

  const strategySheet = workbook.getWorksheet(STRATEGY_COMPARISON.sheet);
  if (strategySheet) {
    results.strategyComparison = STRATEGY_COMPARISON.columns.map(
      ({ col, strategy }) => ({
        strategy,
        annualCost: cellValue(
          strategySheet.getCell(`${col}${STRATEGY_COMPARISON.rows.annualCost}`),
        ),
        reliability: cellValue(
          strategySheet.getCell(`${col}${STRATEGY_COMPARISON.rows.reliability}`),
        ),
        dieselUse: cellValue(
          strategySheet.getCell(`${col}${STRATEGY_COMPARISON.rows.dieselUse}`),
        ),
        payback: cellValue(
          strategySheet.getCell(`${col}${STRATEGY_COMPARISON.rows.payback}`),
        ),
        recommended: cellValue(
          strategySheet.getCell(`${col}${STRATEGY_COMPARISON.rows.recommended}`),
        ),
      }),
    );
  }

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

function verifyWrittenInputs(workbook, formData) {
  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const expectedProperty = formData.propertyType;
  const actualProperty = cellValue(
    userInputs.getCell(USER_INPUT_CELLS.propertyType),
  );
  const expectedMethod = INPUT_METHOD_LABELS[formData.inputMethod] || null;
  const actualMethod = cellValue(
    userInputs.getCell(USER_INPUT_CELLS.inputMethod),
  );
  const expectedUsage = toNumber(formData.bill?.monthlyUsage);
  const actualUsage = cellValue(
    userInputs.getCell(USER_INPUT_CELLS.monthlyUsageKwh),
  );

  excelDebugLog(
    `[excel-debug] verifyWrittenInputs property expected="${expectedProperty}" actual="${actualProperty}" method expected="${expectedMethod}" actual="${actualMethod}" usage expected=${expectedUsage} actual=${actualUsage}`,
  );

  if (expectedProperty && actualProperty !== expectedProperty) {
    console.warn(
      `Excel write verify: propertyType expected "${expectedProperty}" got "${actualProperty}"`,
    );
  }
  if (expectedMethod && actualMethod !== expectedMethod) {
    console.warn(
      `Excel write verify: inputMethod expected "${expectedMethod}" got "${actualMethod}"`,
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

function cellFormula(cell) {
  if (!cell) return null;
  if (typeof cell.formula === "string" && cell.formula.trim()) {
    return cell.formula;
  }
  const v = cell.value;
  if (v && typeof v === "object") {
    if (typeof v.formula === "string" && v.formula.trim()) return v.formula;
    if (typeof v.sharedFormula === "string" && v.sharedFormula.trim()) {
      return v.sharedFormula;
    }
  }
  return null;
}

/** CHOOSE() library name ranges from an Appliance_Input INDEX formula. */
function parseChooseLibraryDRanges(formula) {
  if (!formula) return [];
  return [...String(formula).matchAll(/Appliance_Library!\$?D\$?(\d+):\$?D\$?(\d+)/gi)].map(
    (m) => [Number(m[1]), Number(m[2])],
  );
}

function shiftLibraryRanges(ranges, delta) {
  if (!delta) return ranges;
  return ranges.map(([start, end]) => [start + delta, end + delta]);
}

function findChooseIndex(ranges, librarySheet, propertyType, template) {
  const property = String(propertyType ?? "").trim();
  const selected = String(template ?? "").trim();
  const exact = [];
  const fuzzy = [];

  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    for (let r = start; r <= end; r++) {
      const cat = String(cellValue(librarySheet.getCell(`A${r}`)) ?? "").trim();
      const tmpl = String(cellValue(librarySheet.getCell(`B${r}`)) ?? "").trim();
      if (!tmpl) continue;
      if (cat && cat !== property) continue;
      if (tmpl.toLowerCase() === selected.toLowerCase()) {
        exact.push(i);
        break;
      }
      if (libraryTemplateMatches(tmpl, selected)) {
        fuzzy.push(i);
        break;
      }
    }
  }

  if (exact.length) return exact[0];
  if (fuzzy.length) return fuzzy[0];
  return -1;
}

function libraryRowMatchesTemplate(librarySheet, libRow, propertyType, template) {
  const property = String(propertyType ?? "").trim();
  const selected = String(template ?? "").trim();
  const cat = String(cellValue(librarySheet.getCell(`A${libRow}`)) ?? "").trim();
  const tmpl = String(cellValue(librarySheet.getCell(`B${libRow}`)) ?? "").trim();
  if (!tmpl) return false;
  if (cat && property && cat !== property) return false;
  if (tmpl.toLowerCase() === selected.toLowerCase()) return true;
  return libraryTemplateMatches(tmpl, selected);
}

function applianceFromLibraryRow(librarySheet, libRow, excelRow) {
  const name = String(cellValue(librarySheet.getCell(`D${libRow}`)) ?? "").trim();
  if (!isUsableApplianceName(name)) return null;

  const qty = Number(cellValue(librarySheet.getCell(`E${libRow}`))) || 0;
  const watts = Number(cellValue(librarySheet.getCell(`F${libRow}`))) || 0;
  const hours = Number(cellValue(librarySheet.getCell(`G${libRow}`))) || 0;
  const dutyCycle = Number(cellValue(librarySheet.getCell(`H${libRow}`)));
  const duty = Number.isFinite(dutyCycle) ? dutyCycle : 1;

  return {
    name,
    qty,
    watts,
    hours,
    dutyCycle: duty,
    dailyKwh: (qty * watts * hours * duty) / 1000,
    excelRow,
    source: "template",
  };
}

/**
 * Appliance_Library!Q4:T43 index used by Appliance_Input IFERROR/INDEX/VLOOKUP:
 * Q=id, R=start row, S=category, T=template name.
 */
function readLibraryLookupStartRow(librarySheet, propertyType, template) {
  const property = String(propertyType ?? "").trim();
  const selected = String(template ?? "").trim();
  if (!selected) return -1;

  const exact = [];
  const fuzzy = [];
  for (let r = 4; r <= 80; r++) {
    const cat = String(cellValue(librarySheet.getCell(`S${r}`)) ?? "").trim();
    const tmpl = String(cellValue(librarySheet.getCell(`T${r}`)) ?? "").trim();
    const startRow = Number(cellValue(librarySheet.getCell(`R${r}`)));
    if (!tmpl || !Number.isFinite(startRow) || startRow < 1) continue;
    if (cat && property && cat !== property) continue;
    if (tmpl.toLowerCase() === selected.toLowerCase()) {
      exact.push(startRow);
      break;
    }
    if (libraryTemplateMatches(tmpl, selected)) fuzzy.push(startRow);
  }
  if (exact.length) return exact[0];
  if (fuzzy.length) return fuzzy[0];
  return -1;
}

function readAppliancesFromLibraryStart(
  librarySheet,
  libStartRow,
  propertyType,
  template,
) {
  const start = APPLIANCE_TABLE.startRow;
  const end = APPLIANCE_TABLE.templateEndRow ?? 20;
  const rows = [];

  for (let r = start; r <= end; r++) {
    const libRow = libStartRow + (r - start);
    if (!libraryRowMatchesTemplate(librarySheet, libRow, propertyType, template)) {
      break;
    }
    const row = applianceFromLibraryRow(librarySheet, libRow, r);
    if (!row) break;
    rows.push(row);
  }

  return rows;
}

/**
 * Simulate Appliance_Input A4:A20 name formulas.
 * Current workbook: INDEX(D$1:D$312, VLOOKUP(...start row...)+fill).
 * Legacy workbook: INDEX/CHOOSE over per-template D ranges.
 * Unused slots are IFERROR blanks (not #REF!); stop at empty / next template.
 */
function readTemplateAppliancesFromInputFormulas(
  workbook,
  propertyType,
  template,
) {
  const inputSheet = workbook.getWorksheet(SHEETS.applianceInput);
  const librarySheet = workbook.getWorksheet(SHEETS.applianceLibrary);
  if (!inputSheet || !librarySheet) return [];

  const lookupStart = readLibraryLookupStartRow(
    librarySheet,
    propertyType,
    template,
  );
  if (lookupStart > 0) {
    return readAppliancesFromLibraryStart(
      librarySheet,
      lookupStart,
      propertyType,
      template,
    );
  }

  const start = APPLIANCE_TABLE.startRow;
  const end = APPLIANCE_TABLE.templateEndRow ?? 20;
  const nameCol = APPLIANCE_TABLE.columns.name;

  const a4Formula = cellFormula(inputSheet.getCell(`${nameCol}${start}`));
  const a4Ranges = parseChooseLibraryDRanges(a4Formula).filter(
    ([rangeStart, rangeEnd]) => rangeEnd - rangeStart < 80,
  );
  if (!a4Ranges.length) return [];

  const chooseIndex = findChooseIndex(
    a4Ranges,
    librarySheet,
    propertyType,
    template,
  );
  if (chooseIndex < 0) return [];

  const rows = [];
  for (let r = start; r <= end; r++) {
    const nameCell = inputSheet.getCell(`${nameCol}${r}`);
    const formula = cellFormula(nameCell);

    // Unused slots may be blank (no formula). Static pasted names still count.
    if (!formula) {
      const fromInput = readApplianceInputRowAt(inputSheet, r);
      if (fromInput) rows.push(fromInput);
      continue;
    }

    let ranges = parseChooseLibraryDRanges(formula).filter(
      ([rangeStart, rangeEnd]) => rangeEnd - rangeStart < 80,
    );
    if (!ranges.length) {
      ranges = shiftLibraryRanges(a4Ranges, r - start);
    }

    const range = ranges[chooseIndex];
    if (!range) continue;

    const [rangeStart, rangeEnd] = range;
    const indexArg = r - start + 1;
    const rangeLen = rangeEnd - rangeStart + 1;
    if (indexArg < 1 || indexArg > rangeLen) continue;

    const libRow = rangeStart + indexArg - 1;
    if (!libraryRowMatchesTemplate(librarySheet, libRow, propertyType, template)) {
      break;
    }

    const row = applianceFromLibraryRow(librarySheet, libRow, r);
    if (!row) break;
    rows.push(row);
  }

  return rows;
}

/**
 * Read template appliances from Appliance_Library (static values).
 * Fallback when Appliance_Input INDEX/CHOOSE formulas cannot be parsed.
 */
function readTemplateAppliancesFromLibrary(workbook, propertyType, template) {
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
 * Prefill flow: resolve the selected template via Appliance_Input formulas
 * (VLOOKUP start row / legacy CHOOSE). Skip blank and #REF! names.
 * Cached Appliance_Input values are last resort (they reflect the last-saved
 * template, not the one just selected).
 */
export async function getTemplatePrefill(propertyType, template) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(getTemplatePath());

  let applianceRows = readTemplateAppliancesFromInputFormulas(
    workbook,
    propertyType,
    template,
  );
  if (!applianceRows.length) {
    applianceRows = readTemplateAppliancesFromLibrary(
      workbook,
      propertyType,
      template,
    );
  }
  if (!applianceRows.length) {
    applianceRows = readApplianceInputRows(workbook, { templateOnly: true });
  }

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

function snapshotKeyCells(workbook, label, formData = null) {
  if (!excelDebugEnabled()) return null;

  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const billInput = workbook.getWorksheet(SHEETS.billInput);
  const loadSheet = workbook.getWorksheet("Load_Estimation");
  const outputs = workbook.getWorksheet(SHEETS.outputs);

  const snap = {
    label,
    inputMethodRequested: formData?.inputMethod ?? null,
    inputMethodLabelExpected:
      formData?.inputMethod != null
        ? INPUT_METHOD_LABELS[formData.inputMethod] || formData.inputMethod
        : null,
    userInputs_B10_propertyType: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.propertyType))
      : null,
    userInputs_B11_template: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.template))
      : null,
    userInputs_B15_inputMethod: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.inputMethod))
      : null,
    userInputs_B18_monthlyUsageKwh: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.monthlyUsageKwh))
      : null,
    userInputs_B25_backupDuration: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.backupDuration))
      : null,
    userInputs_B30_gridTariff: userInputs
      ? cellValue(userInputs.getCell(USER_INPUT_CELLS.gridTariff))
      : null,
    billInput_B6_monthlySpend: billInput
      ? cellValue(billInput.getCell(BILL_INPUT_CELLS.monthlySpend))
      : null,
    loadEstimation_B4_method: loadSheet
      ? cellValue(loadSheet.getCell("B4"))
      : null,
    loadEstimation_B8_monthly: loadSheet
      ? cellValue(loadSheet.getCell("B8"))
      : null,
    outputs_B34_billAnnualLoad: outputs
      ? cellValue(outputs.getCell(ESTIMATED_ANNUAL_LOAD_CELLS.bill))
      : null,
    outputs_B36_estimatedMonthlySpend: outputs
      ? cellValue(outputs.getCell(OUTPUT_LIVE_SUMMARY_CELLS.estimatedMonthlySpend))
      : null,
    outputs_B40_monthlyEnergy: outputs
      ? cellValue(outputs.getCell(OUTPUT_LIVE_SUMMARY_CELLS.monthlyEnergy))
      : null,
    expectedMonthlyUsage: formData ? expectedMonthlyUsage(formData) : null,
  };

  console.log(`[excel-debug] ${label}: ${JSON.stringify(snap)}`);
  return snap;
}

function sizingOutputsMissing(sheetResults) {
  const keys = [
    "recommendedSolarKwp",
    "recommendedBatteryKwh",
    "recommendedInverterKw",
  ];
  return keys.every((key) => {
    const n = Number(sheetResults?.[key]);
    return !Number.isFinite(n);
  });
}

/**
 * Full calculation flow: write inputs, recalculate the workbook, read Outputs.
 * Results always come from the Outputs sheet — never from Node-side formulas.
 *
 * Windows/COM: copy template → COM writes inputs + recalcs.
 * LibreOffice: ExcelJS writeInputs → strip formula caches → soffice recalc → read.
 */
export async function calculateAssessment(formData) {
  const templatePath = getTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Excel template not found: ${templatePath}`);
  }

  const useComDirect = useComDirectWrites();
  excelDebugLog(
    `[excel-debug] calculateAssessment start method=${formData?.inputMethod} property=${formData?.propertyType} template=${formData?.template} useComDirect=${useComDirect} templatePath=${templatePath}`,
  );

  async function runOnce(passLabel, { odsRoundtrip = false } = {}) {
    const workPath = newWorkPath("assessment");
    let recalc = null;
    try {
      fs.copyFileSync(templatePath, workPath);
      excelDebugLog(`[excel-debug] ${passLabel} copied template → ${workPath}`);

      if (!useComDirect) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(workPath);
        snapshotKeyCells(workbook, `${passLabel} before-write`, formData);
        writeInputs(workbook, formData);
        verifyWrittenInputs(workbook, formData);
        stripCachedFormulaResults(workbook);
        snapshotKeyCells(workbook, `${passLabel} after-write`, formData);
        await workbook.xlsx.writeFile(workPath);
        excelDebugLog(
          `[excel-debug] ${passLabel} wrote inputs workSize=${fs.statSync(workPath).size}`,
        );
      }

      recalc = await recalculateWorkbook(workPath, formData, { odsRoundtrip });

      const result = new ExcelJS.Workbook();
      await result.xlsx.readFile(recalc.outPath);
      snapshotKeyCells(result, `${passLabel} after-recalc`, formData);
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
      excelDebugLog(
        `[excel-debug] ${passLabel} freshness ok=${freshness.ok} reason=${freshness.reason} load=${JSON.stringify(loadCheck)} backup=${JSON.stringify(backupCheck)}`,
      );
      const sheetResults = readOutputs(result);
      sheetResults.rowDailyKwh = readDailyKwhByRow(
        result,
        formData.inputMethod,
      );

      return { workPath, recalc, result, freshness, sheetResults };
    } catch (error) {
      console.error(
        `[excel-debug] ${passLabel} failed: ${error.message || error}`,
      );
      safeUnlink(workPath);
      if (recalc) safeUnlink(recalc.cleanupDir);
      throw error;
    }
  }

  function finalizeResults(pass) {
    const sheetResults = pass.sheetResults;
    sheetResults.calculationSource = useComDirect
      ? "excel-com"
      : "libreoffice";

    if (sizingOutputsMissing(sheetResults)) {
      sheetResults.calculationError = pass.freshness.ok
        ? "Outputs sizing cells were empty after recalculation."
        : `The calculation could not be completed fully (${pass.freshness.reason}). Some values may be unavailable.`;
      console.warn(
        `Excel Outputs sizing empty after recalc (${pass.freshness.reason}); returning sheet values as-is.`,
      );
    } else if (!pass.freshness.ok) {
      console.warn(
        `Excel Outputs freshness check failed (${pass.freshness.reason}); returning Outputs sheet values as-is.`,
      );
    }

    return sheetResults;
  }

  let pass = await runOnce("pass1", { odsRoundtrip: false });
  try {
    if (pass.freshness.ok) {
      return finalizeResults(pass);
    }

    console.warn(
      `Excel Outputs freshness check failed (${pass.freshness.reason}); retrying with ${
        useComDirect ? "fresh template" : "ODS round-trip"
      }…`,
    );
    safeUnlink(pass.workPath);
    if (pass.recalc) safeUnlink(pass.recalc.cleanupDir);
    pass = await runOnce("pass2", { odsRoundtrip: !useComDirect });
    return finalizeResults(pass);
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
  excelDebugLog(
    `[excel-debug] getLiveSummary request method=${formData?.inputMethod} bill.monthlyUsage=${formData?.bill?.monthlyUsage} bill.monthlySpend=${formData?.bill?.monthlySpend} roofArea=${formData?.roofArea}`,
  );
  const results = await calculateAssessment(formData);
  const method = formData.inputMethod || "bill";
  const methodSummary = results.summary?.[method] || {};
  const billSummary = results.summary?.bill || {};

  const payload = {
    inputMethod: method,
    estimatedAnnualLoadKwh: methodSummary.estimatedAnnualLoadKwh ?? null,
    estimatedMonthlySpend:
      method === "bill"
        ? (billSummary.estimatedMonthlySpend ?? null)
        : null,
    estimatedMonthlyEnergyKwh: billSummary.estimatedMonthlyEnergyKwh ?? null,
    summary: results.summary,
    rowDailyKwh: Array.isArray(results.rowDailyKwh) ? results.rowDailyKwh : [],
    calculationSource: results.calculationSource || null,
  };
  excelDebugLog(
    `[excel-debug] getLiveSummary ok annualLoad=${payload.estimatedAnnualLoadKwh} monthlySpend=${payload.estimatedMonthlySpend} monthlyEnergy=${payload.estimatedMonthlyEnergyKwh} source=${payload.calculationSource}`,
  );
  return payload;
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

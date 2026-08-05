import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { getTemplatePath, SHEETS } from "../config/excelMapping.js";
import { invalidateCatalogCache } from "./excelReader.service.js";

const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;
const DEFAULT_DOWNLOAD_NAME = "solarvy-calculator.xlsx";

/** Sheets required for catalogs, calculation, and COM recalc. */
const REQUIRED_SHEETS = [
  ...Object.values(SHEETS),
  "Load_Estimation",
  "Solar_Sizing",
  "Battery_Sizing",
  "Diesel_Economics",
  "Financial_Model",
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMetaPath(templatePath = getTemplatePath()) {
  const dir = path.dirname(templatePath);
  const base = path.basename(templatePath, path.extname(templatePath));
  return path.join(dir, `${base}.meta.json`);
}

/**
 * Safe display / download basename from an upload name.
 * Rejects path segments; requires .xlsx.
 */
export function sanitizeOriginalFileName(originalName = "") {
  const base = path.basename(String(originalName).replace(/\\/g, "/")).trim();
  if (!base || base === "." || base === "..") return null;
  if (!base.toLowerCase().endsWith(".xlsx")) return null;
  if (/[\u0000-\u001f<>:"|?*]/.test(base)) return null;
  return base;
}

function readTemplateMeta(templatePath) {
  const metaPath = getMetaPath(templatePath);
  if (!fs.existsSync(metaPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const originalFileName = sanitizeOriginalFileName(raw?.originalFileName);
    if (!originalFileName) return null;
    return {
      originalFileName,
      uploadedAt:
        typeof raw.uploadedAt === "string" ? raw.uploadedAt : null,
    };
  } catch {
    return null;
  }
}

function writeTemplateMeta(templatePath, originalName) {
  const originalFileName = sanitizeOriginalFileName(originalName);
  if (!originalFileName) return null;

  const meta = {
    originalFileName,
    uploadedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getMetaPath(templatePath), JSON.stringify(meta, null, 2));
  return meta;
}

function deleteBackupTemplates(targetDir) {
  if (!fs.existsSync(targetDir)) return;

  for (const entry of fs.readdirSync(targetDir)) {
    if (!entry.includes(".backup.") || !entry.toLowerCase().endsWith(".xlsx")) {
      continue;
    }
    try {
      fs.unlinkSync(path.join(targetDir, entry));
    } catch {
      // ignore locked / already-deleted backups
    }
  }
}

export function getTemplateInfo() {
  const templatePath = getTemplatePath();
  const diskName = path.basename(templatePath);
  const meta = readTemplateMeta(templatePath);
  const fileName = meta?.originalFileName || diskName;

  if (!fs.existsSync(templatePath)) {
    return {
      path: templatePath,
      fileName,
      exists: false,
      sizeBytes: null,
      sizeLabel: null,
      modifiedAt: null,
    };
  }

  const stat = fs.statSync(templatePath);
  return {
    path: templatePath,
    fileName,
    exists: true,
    sizeBytes: stat.size,
    sizeLabel: formatBytes(stat.size),
    modifiedAt: stat.mtime.toISOString(),
  };
}

/**
 * Absolute path of the active template for byte-for-byte download.
 * Returns null when the file is missing.
 */
export function getTemplateDownloadPath() {
  const templatePath = getTemplatePath();
  if (!fs.existsSync(templatePath)) return null;
  return templatePath;
}

/** Safe Content-Disposition filename for the active template download. */
export function getTemplateDownloadFileName() {
  const templatePath = getTemplatePath();
  const meta = readTemplateMeta(templatePath);
  return meta?.originalFileName || DEFAULT_DOWNLOAD_NAME;
}

async function validateWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetNames = new Set(workbook.worksheets.map((ws) => ws.name));
  const missing = REQUIRED_SHEETS.filter((name) => !sheetNames.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Workbook is missing required sheet(s): ${missing.join(", ")}`,
    );
  }

  return workbook;
}

/**
 * Replace the active Excel template at getTemplatePath().
 * Validates structure, overwrites the active file, records the upload name,
 * and deletes any leftover *.backup.*.xlsx copies.
 */
export async function replaceTemplate(buffer, originalName = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Empty upload");
  }

  if (buffer.length > MAX_TEMPLATE_BYTES) {
    throw new Error(
      `File too large (max ${formatBytes(MAX_TEMPLATE_BYTES)})`,
    );
  }

  const safeName = sanitizeOriginalFileName(originalName);
  if (originalName && !safeName) {
    throw new Error("Only .xlsx files are accepted");
  }

  await validateWorkbookBuffer(buffer);

  const targetPath = getTemplatePath();
  const targetDir = path.dirname(targetPath);
  fs.mkdirSync(targetDir, { recursive: true });

  const tempPath = path.join(
    targetDir,
    `.upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`,
  );

  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }

    const code = error?.code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new Error(
        "Unable to replace the template. Close Microsoft Excel if the workbook is open, then try again.",
      );
    }
    throw error;
  }

  if (safeName) {
    writeTemplateMeta(targetPath, safeName);
  }

  deleteBackupTemplates(targetDir);
  invalidateCatalogCache();

  return getTemplateInfo();
}

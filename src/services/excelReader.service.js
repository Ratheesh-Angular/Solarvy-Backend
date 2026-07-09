import fs from "node:fs";
import ExcelJS from "exceljs";
import {
  getTemplatePath,
  SHEETS,
  TEMPLATE_RANGES,
  DROPDOWN_FALLBACKS,
  STATE_RANGE,
  CITY_RANGE,
} from "../config/excelMapping.js";

let cache = null;
let cacheMtimeMs = 0;

/** Normalize an ExcelJS cell value to a plain string/number. */
export function cellValue(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.result !== undefined) {
      return v.result?.error ? null : v.result;
    }
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text) return v.text;
    if (v.error) return null;
    if (v instanceof Date) return v.toISOString();
    return null;
  }
  return v;
}

function readColumnRange(sheet, range) {
  const [start, end] = range.split(":");
  const col = start.replace(/\d+/g, "");
  const startRow = Number(start.replace(/\D+/g, ""));
  const endRow = Number(end.replace(/\D+/g, ""));

  const values = [];
  for (let r = startRow; r <= endRow; r++) {
    const v = cellValue(sheet.getCell(`${col}${r}`));
    if (v !== null && String(v).trim() !== "") {
      values.push(String(v).trim());
    }
  }
  return values;
}

/** Parse an inline data-validation list like "Home,Hotel,Commercial". */
function parseValidationList(sheet, cellRef) {
  try {
    const dv = sheet.dataValidations?.model?.[cellRef];
    const formula = dv?.formulae?.[0];
    if (typeof formula === "string" && formula.startsWith('"')) {
      return formula
        .replace(/^"|"$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // fall through to fallback
  }
  return null;
}

function resolveDefinedNameRange(workbook, name) {
  try {
    const ranges = workbook.definedNames.getRanges(name);
    if (ranges?.ranges?.length) {
      // e.g. "User_Inputs!$L$4:$L$10"
      const full = ranges.ranges[0];
      const [sheetName, ref] = full.split("!");
      return {
        sheetName: sheetName.replace(/^'|'$/g, ""),
        range: ref.replace(/\$/g, ""),
      };
    }
  } catch {
    // fall back to hardcoded ranges
  }
  return null;
}

async function loadCatalogs() {
  const templatePath = getTemplatePath();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const userInputs = workbook.getWorksheet(SHEETS.userInputs);
  const equipmentDefault = workbook.getWorksheet(SHEETS.equipmentDefault);
  const categoryMenu = workbook.getWorksheet(SHEETS.categoryMenu);

  const propertyTypes =
    parseValidationList(userInputs, "B10") || DROPDOWN_FALLBACKS.propertyTypes;
  const powerSetups =
    parseValidationList(userInputs, "B13") || DROPDOWN_FALLBACKS.powerSetups;
  const objectives =
    parseValidationList(userInputs, "B14") || DROPDOWN_FALLBACKS.objectives;
  const countries =
    parseValidationList(userInputs, "B7") || DROPDOWN_FALLBACKS.countries;
  const backupDurations =
    parseValidationList(userInputs, "B25") || DROPDOWN_FALLBACKS.backupDurations;

  // Dependent template lists: defined names Home/Hotel/... -> User_Inputs L-column ranges
  const templatesByProperty = {};
  for (const property of propertyTypes) {
    const resolved = resolveDefinedNameRange(workbook, property);
    if (resolved) {
      const sheet = workbook.getWorksheet(resolved.sheetName) || userInputs;
      templatesByProperty[property] = readColumnRange(sheet, resolved.range);
    } else if (TEMPLATE_RANGES[property]) {
      templatesByProperty[property] = readColumnRange(
        userInputs,
        TEMPLATE_RANGES[property],
      );
    } else {
      templatesByProperty[property] = [];
    }
  }

  // Category descriptions (Category Menu: A=category, C=bestFor, D=userLabel)
  const categoryDescriptions = {};
  if (categoryMenu) {
    for (let r = 2; r <= 10; r++) {
      const name = cellValue(categoryMenu.getCell(`A${r}`));
      if (!name) continue;
      categoryDescriptions[String(name).trim()] = {
        bestFor: String(cellValue(categoryMenu.getCell(`C${r}`)) ?? "").trim(),
        userLabel: String(cellValue(categoryMenu.getCell(`D${r}`)) ?? "").trim(),
      };
    }
  }

  // Equipment Default catalog rows (A2 downward until blank)
  const equipmentCatalog = [];
  if (equipmentDefault) {
    for (let r = 2; r <= 200; r++) {
      const name = cellValue(equipmentDefault.getCell(`A${r}`));
      if (name === null || String(name).trim() === "") break;
      equipmentCatalog.push({
        name: String(name).trim(),
        watts: Number(cellValue(equipmentDefault.getCell(`B${r}`))) || 0,
        hoursPerDay: Number(cellValue(equipmentDefault.getCell(`C${r}`))) || 0,
        usagePattern: String(
          cellValue(equipmentDefault.getCell(`D${r}`)) ?? "",
        ).trim(),
        dutyCycle: Number(cellValue(equipmentDefault.getCell(`E${r}`))) || 1,
        surgeFactor: Number(cellValue(equipmentDefault.getCell(`F${r}`))) || 1,
        criticalByDefault: String(
          cellValue(equipmentDefault.getCell(`G${r}`)) ?? "",
        ).trim(),
      });
    }
  }

  const states = readColumnRange(userInputs, STATE_RANGE);
  const cities = readColumnRange(userInputs, CITY_RANGE);

  const templatesTitle =
    String(cellValue(userInputs.getCell("A11")) ?? "Templates").trim() ||
    "Templates";

  return {
    propertyTypes,
    templatesByProperty,
    templatesTitle,
    categoryDescriptions,
    powerSetups,
    objectives,
    countries,
    states,
    cities,
    backupDurations,
    equipmentCatalog,
  };
}

/** Catalogs cached by template file mtime — client workbook updates picked up automatically. */
export async function getCatalogs() {
  const templatePath = getTemplatePath();
  const stat = fs.statSync(templatePath);

  if (!cache || stat.mtimeMs !== cacheMtimeMs) {
    cache = await loadCatalogs();
    cacheMtimeMs = stat.mtimeMs;
  }

  return cache;
}

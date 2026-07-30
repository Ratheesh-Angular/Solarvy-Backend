/**
 * Rebuild stripped calculation sheets so Outputs B15–B19 / B27–B29 resolve.
 * Run: node scripts/restore-calc-sheets.mjs
 */
import ExcelJS from "exceljs";
import { getTemplatePath } from "../src/config/excelMapping.js";

function setLabel(sheet, ref, text) {
  sheet.getCell(ref).value = text;
}

function setFormula(sheet, ref, formula, result = null) {
  const cell = sheet.getCell(ref);
  cell.value = result === null ? { formula } : { formula, result };
}

function setNumber(sheet, ref, value) {
  sheet.getCell(ref).value = value;
}

async function main() {
  const templatePath = getTemplatePath();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const load = workbook.getWorksheet("Load_Estimation");
  const solar = workbook.getWorksheet("Solar_Sizing");
  const battery = workbook.getWorksheet("Battery_Sizing");
  const diesel = workbook.getWorksheet("Diesel_Economics");
  const financial = workbook.getWorksheet("Financial_Model");
  const lead = workbook.getWorksheet("Lead_Routing");
  const objectives = workbook.getWorksheet("Objective_Logic");
  const outputs = workbook.getWorksheet("Outputs");

  if (!load || !solar || !battery || !diesel || !financial || !lead) {
    throw new Error("Required calculation sheets missing from template");
  }

  // --- Load_Estimation ---
  setLabel(load, "A5", "Bill_Monthly_kWh");
  setFormula(load, "B5", "IFERROR(Bill_Input!B11,0)", 0);

  setLabel(load, "A6", "Appliance_Monthly_kWh");
  setFormula(load, "B6", "IFERROR(Appliance_Input!L5,0)", 0);

  setLabel(load, "A7", "Custom_Monthly_kWh");
  setFormula(load, "B7", "IFERROR(Custom_Equipment!M5,0)", 0);

  setLabel(load, "A8", "Selected_Monthly_kWh");
  setFormula(
    load,
    "B8",
    'IF(User_Inputs!B15="Bill",B5,IF(User_Inputs!B15="Appliances",B6,IF(User_Inputs!B15="Custom",B7,MAX(B5,B6,B7))))',
    0,
  );

  setLabel(load, "A9", "Daily_Load_kWh");
  setFormula(load, "B9", "IFERROR(B8/MAX(Bill_Input!B8,1),0)", 0);

  setLabel(load, "A10", "Annual_Load_kWh");
  setFormula(load, "B10", "B8*12", 0);

  // --- Solar_Sizing ---
  setLabel(solar, "A5", "Peak_Sun_Hours");
  setNumber(solar, "B5", 4.5);

  setLabel(solar, "A6", "Performance_Ratio");
  setNumber(solar, "B6", 0.75);

  setLabel(solar, "A7", "Target_Solar_Share");
  setFormula(solar, "B7", "IFERROR(User_Inputs!B26,0.6)", 0.6);

  setLabel(solar, "A8", "Roof_kWp_Limit");
  setFormula(
    solar,
    "B8",
    "IFERROR(User_Inputs!B21*User_Inputs!B22/6,0)",
    0,
  );

  setLabel(solar, "A9", "Unconstrained_kWp");
  setFormula(
    solar,
    "B9",
    "IFERROR((Load_Estimation!B9*B7)/(B5*B6),0)",
    0,
  );

  setLabel(solar, "A12", "Recommended_Solar_kWp");
  setFormula(
    solar,
    "B12",
    "IFERROR(ROUND(MAX(0.5,IF(B8>0,MIN(B9,B8),B9)),1),0.5)",
    0.5,
  );

  setLabel(solar, "A13", "Annual_PV_Generation_kWh");
  setFormula(solar, "B13", "B12*B5*B6*365", 0);

  setLabel(solar, "A14", "Daily_Usable_Solar_kWh");
  setFormula(
    solar,
    "B14",
    "IFERROR(MIN(B13/365,Load_Estimation!B9),0)",
    0,
  );

  // --- Battery_Sizing ---
  setLabel(battery, "A5", "Critical_Daily_kWh");
  setFormula(
    battery,
    "B5",
    "IFERROR(Load_Estimation!B9*User_Inputs!B24,0)",
    0,
  );

  setLabel(battery, "A6", "Usable_DoD");
  setFormula(
    battery,
    "B6",
    "IF(User_Inputs!B27<=0.5,1-User_Inputs!B27,User_Inputs!B27)",
    0.8,
  );

  setLabel(battery, "A10", "Recommended_Battery_kWh");
  setFormula(
    battery,
    "B10",
    "IFERROR(ROUND(MAX(1,(B5*User_Inputs!B25)/(24*MAX(B6,0.5))),1),1)",
    1,
  );

  setLabel(battery, "A12", "Recommended_Inverter_kW");
  setFormula(
    battery,
    "B12",
    "IFERROR(ROUND(MAX(1,User_Inputs!B19,Load_Estimation!B9/4,Solar_Sizing!B12*0.8),1),1)",
    1,
  );

  // --- Diesel_Economics ---
  setLabel(diesel, "A5", "Outage_Fraction");
  setFormula(diesel, "B5", "IFERROR(User_Inputs!B20/24,0)", 0);

  setLabel(diesel, "A8", "Diesel_kWh_Displaced");
  setFormula(diesel, "B8", "IFERROR(Solar_Sizing!B13*B5,0)", 0);

  setLabel(diesel, "A9", "Diesel_Saved_Litres");
  setFormula(
    diesel,
    "B9",
    "IFERROR(B8/MAX(User_Inputs!B32,0.1),0)",
    0,
  );

  // --- Financial_Model ---
  setLabel(financial, "A4", "PV_Cost");
  setFormula(financial, "B4", "Solar_Sizing!B12*User_Inputs!B33", 0);

  setLabel(financial, "A5", "Battery_Cost");
  setFormula(financial, "B5", "Battery_Sizing!B10*User_Inputs!B34", 0);

  setLabel(financial, "A6", "Inverter_Cost");
  setFormula(financial, "B6", "Battery_Sizing!B12*User_Inputs!B35", 0);

  setLabel(financial, "A7", "BOS_Cost");
  setFormula(financial, "B7", "(B4+B5+B6)*User_Inputs!B36", 0);

  setLabel(financial, "A8", "Capex_Subtotal");
  setFormula(financial, "B8", "B4+B5+B6+B7", 0);

  setLabel(financial, "A9", "Estimated_System_Cost");
  setFormula(financial, "B9", "B8", 0);

  setLabel(financial, "A10", "Gross_Annual_Savings");
  setFormula(
    financial,
    "B10",
    "Solar_Sizing!B13*Bill_Input!B7+Diesel_Economics!B9*User_Inputs!B31",
    0,
  );

  setLabel(financial, "A11", "Annual_OM_Allowance");
  setFormula(financial, "B11", "B9*User_Inputs!B37", 0);

  setLabel(financial, "A12", "Net_Annual_Savings");
  setFormula(financial, "B12", "B10-B11", 0);

  setLabel(financial, "A13", "Simple_Payback_Years");
  setFormula(financial, "B13", "IFERROR(B9/B12,0)", 0);
  financial.getCell("B13").numFmt = "0.0";

  // --- Lead_Routing ---
  setLabel(lead, "A6", "Lead_Type");
  setFormula(
    lead,
    "B6",
    'IF(Financial_Model!B13<=0,"Review",IF(Financial_Model!B13<=5,"Hot",IF(Financial_Model!B13<=8,"Warm","Nurture")))',
    "Review",
  );

  setLabel(lead, "A7", "Recommended_Next_Step");
  setFormula(
    lead,
    "B7",
    'IF(B6="Hot","Book installer intro",IF(B6="Warm","Request expert review","Download report and revisit"))',
    "Download report and revisit",
  );

  // --- Objective_Logic lookup table (Outputs!B23 VLOOKUP) ---
  if (objectives) {
    const rows = [
      [
        "Reduce Electricity Bills",
        0.7,
        0.3,
        0.4,
        1,
        "Prioritise bill reduction with daytime solar offset",
      ],
      [
        "Reduce Diesel Use",
        0.5,
        0.7,
        0.6,
        1,
        "Prioritise diesel displacement with hybrid solar + storage",
      ],
      [
        "Backup During Outages",
        0.4,
        0.5,
        0.9,
        1,
        "Prioritise backup autonomy with battery-first sizing",
      ],
    ];
    rows.forEach((row, i) => {
      const r = 4 + i;
      row.forEach((value, colIdx) => {
        objectives.getCell(r, colIdx + 1).value = value;
      });
    });
  }

  // Guard Outputs % rows against #DIV/0! when load is zero
  setFormula(
    outputs,
    "B27",
    "IFERROR(Solar_Sizing!B14/Load_Estimation!B9,0)",
    0,
  );
  setFormula(
    outputs,
    "B28",
    "IFERROR((Solar_Sizing!B14*(1-User_Inputs!B20/24))/Load_Estimation!B9,0)",
    0,
  );
  setFormula(
    outputs,
    "B29",
    "IFERROR((Solar_Sizing!B14*(User_Inputs!B20/24))/Load_Estimation!B9,0)",
    0,
  );

  await workbook.xlsx.writeFile(templatePath);
  console.log("Restored calculation sheets in:", templatePath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

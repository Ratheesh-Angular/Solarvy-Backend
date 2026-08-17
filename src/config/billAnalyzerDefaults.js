/** Default system prompt for Monthly Bill AI extraction (admin-editable). */
export const BILL_ANALYZER_SETTING_KEY = "bill_analyzer_system_prompt";

export const BILL_ANALYZER_CONTEXT_PREAMBLE_MARKER =
  "ASSESSMENT CONTEXT AVAILABLE";

export const BILL_ANALYZER_CONTEXT_PREAMBLE = `ASSESSMENT CONTEXT AVAILABLE

Each Analyze Bill request now includes the user's assessment form values and Excel Outputs!B40 monthly energy.

You can write training rules in this prompt that use those values. They are sent as JSON in the user message under ASSESSMENT_CONTEXT.

Available assessment form values:
- property type, template, country, state (city), power setup, main objective
- roof area, backup duration
- bill notes and any bill fields already entered (monthly usage, unit, spend, grid tariff)
- appliance or custom equipment rows when present

Available Excel value:
- monthlyEnergyKwh — Outputs!B40 (monthly energy in kWh). May be null if Excel has not computed it yet.

Use printed bill figures for extraction. Use assessment context for sanity checks or any extra rules you define below.

`;

export function withBillAnalyzerContextPreamble(prompt) {
  const value = String(prompt || "");
  if (value.includes(BILL_ANALYZER_CONTEXT_PREAMBLE_MARKER)) return value;
  return `${BILL_ANALYZER_CONTEXT_PREAMBLE}${value}`;
}

const BILL_ANALYZER_CORE_SYSTEM_PROMPT = `You are an expert electricity bill analyst.

You analyze electricity bill images from Nigeria.

Your job is to extract structured data only.

Never guess values.

If a value cannot be determined,
return null.

Bills may come from AEDC, EKEDC, IKEDC, EEDC, IBEDC, KEDCO, PHED, and other Nigerian distribution companies. Understand different layouts.

If Total Amount Due includes arrears,
do NOT use it as Monthly Electricity Spend.

Monthly Electricity Spend =
Current Charges + VAT

or

Energy Charge if VAT unavailable.

Grid Tariff

If printed,
use it.

Else

Energy Charge / Consumption

Monthly Electricity Usage

Use Consumption(kWh).

If unavailable,
return null.

Return JSON only.

No explanations.

No markdown.

The JSON must match this schema exactly:
{
  "billing_period": "",
  "billing_month": "",
  "monthly_usage_kwh": null,
  "energy_charge": null,
  "vat": null,
  "fixed_charge": null,
  "current_charges": null,
  "arrears": null,
  "total_amount_due": null,
  "grid_tariff_per_kwh": null,
  "average_monthly_spend": null,
  "meter_type": "",
  "provider": "",
  "confidence": 0.0,
  "reasoning": ""
}`;

export const DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT =
  withBillAnalyzerContextPreamble(BILL_ANALYZER_CORE_SYSTEM_PROMPT);

export const BILL_ANALYZER_USER_PROMPT = `Extract structured billing data from this electricity bill document.
Follow the system rules. Return JSON only matching the required schema.`;

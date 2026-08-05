function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").replace(/[₦N]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampConfidence(value) {
  const n = toNumberOrNull(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Validate / normalize AI bill JSON and map to assessment form fields.
 */
export function validateAndMapBillExtraction(raw) {
  const warnings = [];
  const data = raw && typeof raw === "object" ? raw : {};

  let monthlyUsage = toNumberOrNull(data.monthly_usage_kwh);
  let energyCharge = toNumberOrNull(data.energy_charge);
  let vat = toNumberOrNull(data.vat);
  let currentCharges = toNumberOrNull(data.current_charges);
  let arrears = toNumberOrNull(data.arrears);
  let totalAmountDue = toNumberOrNull(data.total_amount_due);
  let gridTariff = toNumberOrNull(data.grid_tariff_per_kwh);
  let averageMonthlySpend = toNumberOrNull(data.average_monthly_spend);
  let confidence = clampConfidence(data.confidence);

  const rejectIfNegative = (label, value, setter) => {
    if (value !== null && value < 0) {
      warnings.push(`${label} was negative and was discarded`);
      setter(null);
      confidence = Math.min(confidence, 0.4);
    }
  };

  rejectIfNegative("monthly_usage_kwh", monthlyUsage, (v) => {
    monthlyUsage = v;
  });
  rejectIfNegative("energy_charge", energyCharge, (v) => {
    energyCharge = v;
  });
  rejectIfNegative("vat", vat, (v) => {
    vat = v;
  });
  rejectIfNegative("current_charges", currentCharges, (v) => {
    currentCharges = v;
  });
  rejectIfNegative("grid_tariff_per_kwh", gridTariff, (v) => {
    gridTariff = v;
  });
  rejectIfNegative("average_monthly_spend", averageMonthlySpend, (v) => {
    averageMonthlySpend = v;
  });

  // Derive average monthly spend when AI left it null.
  if (averageMonthlySpend === null) {
    if (currentCharges !== null && vat !== null) {
      averageMonthlySpend = currentCharges + vat;
    } else if (energyCharge !== null) {
      averageMonthlySpend = energyCharge;
    }
  }

  // Never treat Total Amount Due as spend when arrears are present.
  if (
    arrears !== null &&
    arrears > 0 &&
    totalAmountDue !== null &&
    averageMonthlySpend !== null &&
    Math.abs(averageMonthlySpend - totalAmountDue) < 1
  ) {
    warnings.push(
      "average_monthly_spend matched Total Amount Due while arrears exist; discarded",
    );
    averageMonthlySpend = null;
    if (currentCharges !== null && vat !== null) {
      averageMonthlySpend = currentCharges + vat;
    } else if (energyCharge !== null) {
      averageMonthlySpend = energyCharge;
    }
    confidence = Math.min(confidence, 0.5);
  }

  // Derive tariff when missing.
  if (
    gridTariff === null &&
    energyCharge !== null &&
    monthlyUsage !== null &&
    monthlyUsage > 0
  ) {
    gridTariff = energyCharge / monthlyUsage;
  }

  // Cross-check energy / usage ≈ tariff.
  if (
    energyCharge !== null &&
    monthlyUsage !== null &&
    monthlyUsage > 0 &&
    gridTariff !== null &&
    gridTariff > 0
  ) {
    const implied = energyCharge / monthlyUsage;
    const relativeDiff = Math.abs(implied - gridTariff) / gridTariff;
    if (relativeDiff > 0.15) {
      warnings.push(
        `Tariff mismatch: energy/usage (${implied.toFixed(2)}) vs tariff (${gridTariff.toFixed(2)})`,
      );
      confidence = Math.min(confidence, 0.45);
    }
  }

  const fieldsDetected = [monthlyUsage, averageMonthlySpend, gridTariff].filter(
    (v) => v !== null,
  ).length;

  return {
    monthlyUsage,
    monthlySpend: averageMonthlySpend,
    gridTariff,
    confidence,
    warnings,
    fieldsDetected,
    raw: {
      billing_period: data.billing_period ?? "",
      billing_month: data.billing_month ?? "",
      monthly_usage_kwh: monthlyUsage,
      energy_charge: energyCharge,
      vat,
      fixed_charge: toNumberOrNull(data.fixed_charge),
      current_charges: currentCharges,
      arrears,
      total_amount_due: totalAmountDue,
      grid_tariff_per_kwh: gridTariff,
      average_monthly_spend: averageMonthlySpend,
      meter_type: data.meter_type ?? "",
      provider: data.provider ?? "",
      confidence,
      reasoning: data.reasoning ?? "",
    },
  };
}

export function getConfidenceMin() {
  const n = Number(process.env.BILL_AI_CONFIDENCE_MIN);
  return Number.isFinite(n) ? n : 0.6;
}

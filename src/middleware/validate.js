function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateRequestIntro(req, res, next) {
  const { fullName, phoneNumber, email } = req.body;

  if (!isNonEmptyString(fullName)) {
    res.status(400).json({ success: false, message: "Full name is required" });
    return;
  }

  if (!isNonEmptyString(phoneNumber)) {
    res.status(400).json({ success: false, message: "Phone number is required" });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ success: false, message: "Valid email is required" });
    return;
  }

  next();
}

export function validateContact(req, res, next) {
  validateRequestIntro(req, res, next);
}

export function validateExpertReview(req, res, next) {
  const { fullName, phoneNumber, email, projectLocation } = req.body;

  if (!isNonEmptyString(fullName)) {
    res.status(400).json({ success: false, message: "Full name is required" });
    return;
  }

  if (!isNonEmptyString(phoneNumber)) {
    res.status(400).json({ success: false, message: "Phone number is required" });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ success: false, message: "Valid email is required" });
    return;
  }

  if (!isNonEmptyString(projectLocation)) {
    res
      .status(400)
      .json({ success: false, message: "Project location is required" });
    return;
  }

  next();
}

export function validateAssessment(_req, _res, next) {
  next();
}

export function validateFinancingEnquiry(req, res, next) {
  const body = req.body ?? {};
  const fail = (message) =>
    res.status(400).json({ success: false, message });

  const amount = Number(body.amountToFinance);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail("Amount to finance must be a positive number");
    return;
  }

  if (
    body.depositAvailable != null &&
    body.depositAvailable !== "" &&
    (!Number.isFinite(Number(body.depositAvailable)) ||
      Number(body.depositAvailable) < 0)
  ) {
    fail("Deposit must be zero or a positive number");
    return;
  }

  if (!isNonEmptyString(body.routeId) || body.routeId.length > 80) {
    fail("Financing route is required");
    return;
  }

  if (!isNonEmptyString(body.partnerName) || body.partnerName.length > 255) {
    fail("Financing partner is required");
    return;
  }

  if (
    body.consentShare !== true ||
    body.confirmAccurate !== true ||
    body.confirmTerms !== true
  ) {
    fail("All consent confirmations are required");
    return;
  }

  if (typeof body.notes === "string" && body.notes.length > 2000) {
    fail("Notes must be at most 2000 characters");
    return;
  }

  next();
}

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

export function validateAssessment(req, res, next) {
  const { country, state } = req.body;

  if (!isNonEmptyString(country)) {
    res.status(400).json({ success: false, message: "Country is required" });
    return;
  }

  if (country === "Nigeria" && !isNonEmptyString(state)) {
    res.status(400).json({ success: false, message: "State is required for Nigeria" });
    return;
  }

  next();
}

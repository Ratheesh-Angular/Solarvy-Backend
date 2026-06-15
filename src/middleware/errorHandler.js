const isProduction = process.env.NODE_ENV === "production";

export function errorHandler(err, _req, res, _next) {
  console.error(err);

  if (err.message?.startsWith("CORS blocked")) {
    res.status(403).json({
      success: false,
      message: "Origin not allowed by CORS policy",
    });
    return;
  }

  if (err.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      message: "Invalid JSON in request body",
    });
    return;
  }

  if (err.code === "23505") {
    res.status(409).json({
      success: false,
      message: "A record with this value already exists",
    });
    return;
  }

  if (err.code === "23502") {
    res.status(400).json({
      success: false,
      message: "Required database field is missing",
    });
    return;
  }

  res.status(err.status || 500).json({
    success: false,
    message: isProduction ? "Internal server error" : err.message || "Internal server error",
  });
}

export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
}

export function notFound(req, res, _next) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}
export function errorHandler(error, _req, res, _next) {
  if (process.env.NODE_ENV !== "production") console.error(error);
  const status = error.statusCode || (error.name === "ValidationError" ? 400 : 500);
  res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : error.message
  });
}

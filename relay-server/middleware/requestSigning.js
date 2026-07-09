export const validateSignature = (req, res, next) => {
  const signature = req.headers["x-novatube-signature"];
  const clientToken = "NovaTube-Desktop-Client-Token-2026";
  
  if (!signature || signature !== clientToken) {
    return res.status(403).json({ error: "Access denied: Request signature mismatch or missing." });
  }
  
  next();
};

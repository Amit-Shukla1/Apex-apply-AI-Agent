// ─────────────────────────────────────────────────────────────────────────────
// middleware/auth.js
//
// requireAuth: blocks any request without a valid session. Attaches the
// authenticated user's Mongo _id as req.userId for every protected route to
// scope its queries with. This is the ONE place that decides "is this
// request allowed through" — every data route in server.js must use it.
//
// requireAdmin: stacks on top of requireAuth — only lets isAdmin accounts
// through, for the /api/admin/* dashboard routes.
// ─────────────────────────────────────────────────────────────────────────────

export function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.userId = req.session.userId;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  req.userId = req.session.userId;
  next();
}

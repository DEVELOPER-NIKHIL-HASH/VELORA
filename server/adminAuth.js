import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export function createAdminAuthenticator(adminSecret) {
  return function authenticateAdmin(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "error",
        message: "Admin login required."
      });
    }

    try {
      const token = authorization.slice("Bearer ".length);
      const payload = jwt.verify(token, adminSecret, {
        issuer: "velora-api",
        audience: "velora-admins"
      });

      if (
        typeof payload !== "object" ||
        payload.role !== "admin"
      ) {
        return res.status(401).json({
          status: "error",
          message: "Invalid admin token."
        });
      }

      return next();
    } catch {
      return res.status(401).json({
        status: "error",
        message: "Admin session expired. Please log in again."
      });
    }
  };
}

export function registerAdminAuthRoutes(app, adminSecret, passwordHash) {
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body ?? {};

    if (typeof password !== "string" || !password) {
      return res.status(400).json({
        status: "error",
        message: "Admin password is required."
      });
    }

    try {
      if (!bcrypt.compareSync(password, passwordHash)) {
        return res.status(401).json({
          status: "error",
          message: "Invalid admin password."
        });
      }

      const token = jwt.sign(
        { role: "admin" },
        adminSecret,
        {
          expiresIn: "2h",
          issuer: "velora-api",
          audience: "velora-admins"
        }
      );

      return res.json({
        status: "success",
        message: "Admin login successful.",
        token
      });
    } catch (error) {
      console.error("Admin login error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Could not log in."
      });
    }
  });
}

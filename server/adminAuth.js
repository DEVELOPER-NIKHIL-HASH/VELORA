import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.join(__dirname, ".env");

// In-memory active hash and version state
let activeAdminPasswordHash = "";
let activeAdminTokenVersion = "";

export function computeTokenVersion(hash) {
  return crypto
    .createHash("sha256")
    .update(String(hash))
    .digest("hex")
    .slice(0, 16);
}

export function setAdminPasswordHash(newHash) {
  activeAdminPasswordHash = newHash;
  activeAdminTokenVersion = computeTokenVersion(newHash);
  process.env.ADMIN_PASSWORD_HASH = newHash;
}

export function getAdminPasswordHash() {
  return activeAdminPasswordHash;
}

export function getAdminTokenVersion() {
  return activeAdminTokenVersion;
}

// Check whether real SMTP delivery is configured
export function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  );
}

// Check whether verified admin recovery email is set
export function isAdminRecoveryConfigured() {
  return isSmtpConfigured() && Boolean(process.env.ADMIN_RECOVERY_EMAIL?.trim());
}

// Transporter for admin communications
function getAdminEmailTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production"
    }
  });
}

// In-memory OTP storage for admin password recovery
// Key: resetSessionId -> { email, otpHashed, expiresAt, attempts, createdAt }
const activeResetSessions = new Map();

// Rate limit trackers
// IP -> [timestamps]
const otpRequestIpTracker = new Map();
// Email -> timestamp
const otpRequestCooldownTracker = new Map();

function isRateLimitedByIp(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 5;

  const timestamps = otpRequestIpTracker.get(ip) || [];
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= maxRequests) {
    return true;
  }

  validTimestamps.push(now);
  otpRequestIpTracker.set(ip, validTimestamps);
  return false;
}

function isCooldownActive(email) {
  const now = Date.now();
  const lastRequest = otpRequestCooldownTracker.get(email) || 0;
  const cooldownMs = 60 * 1000; // 60 seconds cooldown

  if (now - lastRequest < cooldownMs) {
    return true;
  }

  otpRequestCooldownTracker.set(email, now);
  return false;
}

// Clean up expired reset sessions periodically
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of activeResetSessions.entries()) {
    if (now > session.expiresAt) {
      activeResetSessions.delete(key);
    }
  }
}

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
        payload.role !== "admin" ||
        !payload.tokenVersion ||
        payload.tokenVersion !== getAdminTokenVersion()
      ) {
        return res.status(401).json({
          status: "error",
          message: "Admin session invalid or expired. Please log in again."
        });
      }

      req.admin = {
        role: "admin"
      };

      return next();
    } catch {
      return res.status(401).json({
        status: "error",
        message: "Admin session expired. Please log in again."
      });
    }
  };
}

export function registerAdminAuthRoutes(app, adminSecret, initialPasswordHash) {
  // Initialize in-memory active hash and version
  setAdminPasswordHash(initialPasswordHash);

  // Authenticator instance for protecting change-password
  const authenticateAdmin = createAdminAuthenticator(adminSecret);

  // 1. Admin Login
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body ?? {};

    if (typeof password !== "string" || !password) {
      return res.status(400).json({
        status: "error",
        message: "Admin password is required."
      });
    }

    try {
      if (!bcrypt.compareSync(password, getAdminPasswordHash())) {
        return res.status(401).json({
          status: "error",
          message: "Invalid admin password."
        });
      }

      const token = jwt.sign(
        {
          role: "admin",
          tokenVersion: getAdminTokenVersion()
        },
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

  // 2. Change Admin Password (Protected)
  app.post("/api/admin/change-password", authenticateAdmin, async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body ?? {};

      if (
        typeof currentPassword !== "string" || !currentPassword ||
        typeof newPassword !== "string" || !newPassword ||
        typeof confirmPassword !== "string" || !confirmPassword
      ) {
        return res.status(400).json({
          status: "error",
          message: "Current password, new password, and confirmation are required."
        });
      }

      // Verify current password
      if (!bcrypt.compareSync(currentPassword, getAdminPasswordHash())) {
        return res.status(401).json({
          status: "error",
          message: "Current password is incorrect."
        });
      }

      // Verify confirmation
      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          status: "error",
          message: "New password and confirmation do not match."
        });
      }

      // Enforce strong password requirements: minimum 12 characters
      if (newPassword.length < 12) {
        return res.status(400).json({
          status: "error",
          message: "New password must be at least 12 characters long."
        });
      }

      // Bcrypt maximum limit guard
      if (Buffer.byteLength(newPassword, "utf8") > 72) {
        return res.status(400).json({
          status: "error",
          message: "New password exceeds 72 bytes."
        });
      }

      // Check if new password is identical to current password
      if (bcrypt.compareSync(newPassword, getAdminPasswordHash())) {
        return res.status(400).json({
          status: "error",
          message: "New password cannot be the same as the current password."
        });
      }

      // Compute bcrypt hash with cost factor 12
      const newHash = await bcrypt.hash(newPassword, 12);

      // Persist to server/.env
      if (!fs.existsSync(ENV_PATH)) {
        throw new Error(".env file not found at " + ENV_PATH);
      }

      const envContent = fs.readFileSync(ENV_PATH, "utf8");
      if (!/^ADMIN_PASSWORD_HASH=.*$/m.test(envContent)) {
        throw new Error("ADMIN_PASSWORD_HASH entry missing in server/.env");
      }

      const updatedEnv = envContent.replace(
        /^ADMIN_PASSWORD_HASH=.*$/m,
        `ADMIN_PASSWORD_HASH=${newHash}`
      );
      fs.writeFileSync(ENV_PATH, updatedEnv, "utf8");

      // Update in-memory hash and rotate tokenVersion (revoking all existing admin tokens)
      setAdminPasswordHash(newHash);

      return res.json({
        status: "success",
        message: "Admin password successfully updated. All previous sessions have been revoked. Please log in with your new password."
      });
    } catch (error) {
      console.error("Change admin password error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Could not update admin password."
      });
    }
  });

  // 3. Forgot Password Configuration Status (Public)
  app.get("/api/admin/forgot-password/status", (_req, res) => {
    return res.json({
      status: "success",
      configured: isAdminRecoveryConfigured()
    });
  });

  // 4. Request Admin Password Reset OTP
  app.post("/api/admin/forgot-password/request", async (req, res) => {
    try {
      cleanExpiredSessions();

      // Check if SMTP and admin recovery email are configured
      if (!isAdminRecoveryConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMTP_NOT_CONFIGURED",
          message: "Admin password recovery is unavailable because SMTP delivery or ADMIN_RECOVERY_EMAIL is not configured on the server."
        });
      }

      const { email } = req.body ?? {};
      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Admin recovery email is required."
        });
      }

      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
      if (isRateLimitedByIp(clientIp)) {
        return res.status(429).json({
          status: "error",
          code: "RATE_LIMITED",
          message: "Too many password reset requests. Please try again in 15 minutes."
        });
      }

      const normalizedInputEmail = email.trim().toLowerCase();
      const configuredRecoveryEmail = process.env.ADMIN_RECOVERY_EMAIL.trim().toLowerCase();

      // Enforce per-email cooldown
      if (isCooldownActive(normalizedInputEmail)) {
        return res.status(429).json({
          status: "error",
          code: "COOLDOWN_ACTIVE",
          message: "A verification code was requested recently. Please wait at least 60 seconds before requesting another."
        });
      }

      // Neutral response to avoid email enumeration
      const genericSuccessResponse = {
        status: "success",
        message: "If a matching administrator recovery email is registered, a single-use verification code has been dispatched."
      };

      // Timing-safe email verification to prevent side-channel timing attacks
      const emailMatches =
        normalizedInputEmail.length === configuredRecoveryEmail.length &&
        crypto.timingSafeEqual(
          Buffer.from(normalizedInputEmail, "utf8"),
          Buffer.from(configuredRecoveryEmail, "utf8")
        );

      if (!emailMatches) {
        // Return generic success without revealing non-existence
        return res.json(genericSuccessResponse);
      }

      // Generate cryptographically secure 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const resetSessionId = crypto.randomBytes(32).toString("hex");

      // Bind OTP to resetSessionId and adminSecret using HMAC SHA-256
      const otpHashed = crypto
        .createHmac("sha256", adminSecret)
        .update(`${resetSessionId}:${otp}`)
        .digest("hex");

      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

      // Save reset session
      activeResetSessions.set(resetSessionId, {
        email: configuredRecoveryEmail,
        otpHashed,
        expiresAt,
        attempts: 0,
        createdAt: Date.now()
      });

      // Send OTP via configured SMTP transporter
      const transporter = getAdminEmailTransporter();
      if (!transporter) {
        throw new Error("Transporter configuration failed.");
      }

      const fromAddress = process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim();

      await transporter.sendMail({
        from: `"VELORA Security" <${fromAddress}>`,
        to: configuredRecoveryEmail,
        subject: "VELORA Admin Password Reset Code",
        text: `Your single-use VELORA Admin verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please review your server security immediately.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090A0D; color: #F5F5F5; padding: 40px 20px;">
            <div style="max-width: 500px; margin: 0 auto; background-color: #121318; border: 1px solid #292A31; border-radius: 12px; padding: 32px 24px;">
              <div style="color: #D4AF65; font-size: 20px; font-weight: 700; letter-spacing: 3px; margin-bottom: 20px;">V E L O R A</div>
              <h2 style="font-size: 18px; margin: 0 0 12px; color: #FFFFFF;">Admin Password Reset</h2>
              <p style="font-size: 13px; color: #9A9BA5; line-height: 1.6; margin: 0 0 20px;">
                A password reset request was initiated for the VELORA Administrator console. Use the single-use verification code below to reset your credentials.
              </p>
              <div style="background-color: #090A0D; border: 1px solid #D4AF65; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 20px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #D4AF65;">${otp}</span>
              </div>
              <p style="font-size: 12px; color: #9A9BA5; margin: 0;">
                This code expires in <strong>10 minutes</strong>. If you did not initiate this request, disregard this email.
              </p>
            </div>
          </div>
        `
      });

      return res.json({
        ...genericSuccessResponse,
        resetSessionId
      });
    } catch (error) {
      console.error("Admin forgot password request error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to process password reset request."
      });
    }
  });

  // 5. Verify OTP and Reset Admin Password
  app.post("/api/admin/forgot-password/reset", async (req, res) => {
    try {
      cleanExpiredSessions();

      if (!isAdminRecoveryConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMTP_NOT_CONFIGURED",
          message: "Admin password recovery is unavailable because SMTP delivery or ADMIN_RECOVERY_EMAIL is not configured on the server."
        });
      }

      const { resetSessionId, otp, newPassword, confirmPassword } = req.body ?? {};

      if (
        typeof resetSessionId !== "string" || !resetSessionId ||
        typeof otp !== "string" || !otp ||
        typeof newPassword !== "string" || !newPassword ||
        typeof confirmPassword !== "string" || !confirmPassword
      ) {
        return res.status(400).json({
          status: "error",
          message: "Reset session ID, verification code, new password, and confirmation are required."
        });
      }

      const session = activeResetSessions.get(resetSessionId);
      if (!session) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_SESSION",
          message: "Reset session has expired or is invalid. Please request a new verification code."
        });
      }

      // Check expiry
      if (Date.now() > session.expiresAt) {
        activeResetSessions.delete(resetSessionId);
        return res.status(400).json({
          status: "error",
          code: "OTP_EXPIRED",
          message: "Verification code has expired. Please request a new code."
        });
      }

      // Check maximum verification attempts (max 5)
      if (session.attempts >= 5) {
        activeResetSessions.delete(resetSessionId);
        return res.status(429).json({
          status: "error",
          code: "MAX_ATTEMPTS_EXCEEDED",
          message: "Maximum incorrect verification attempts exceeded. Reset session invalidated. Please start again."
        });
      }

      // Verify OTP hash using timing-safe comparison
      const cleanOtp = otp.trim();
      const computedHash = crypto
        .createHmac("sha256", adminSecret)
        .update(`${resetSessionId}:${cleanOtp}`)
        .digest("hex");

      const isOtpValid =
        computedHash.length === session.otpHashed.length &&
        crypto.timingSafeEqual(
          Buffer.from(computedHash, "utf8"),
          Buffer.from(session.otpHashed, "utf8")
        );

      if (!isOtpValid) {
        session.attempts += 1;
        const remainingAttempts = 5 - session.attempts;
        return res.status(400).json({
          status: "error",
          code: "INVALID_OTP",
          message: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
        });
      }

      // Validate new password
      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          status: "error",
          message: "New password and confirmation do not match."
        });
      }

      if (newPassword.length < 12) {
        return res.status(400).json({
          status: "error",
          message: "New password must be at least 12 characters long."
        });
      }

      if (Buffer.byteLength(newPassword, "utf8") > 72) {
        return res.status(400).json({
          status: "error",
          message: "New password exceeds 72 bytes."
        });
      }

      // Compute new bcrypt hash
      const newHash = await bcrypt.hash(newPassword, 12);

      // Persist to server/.env
      if (!fs.existsSync(ENV_PATH)) {
        throw new Error(".env file not found at " + ENV_PATH);
      }

      const envContent = fs.readFileSync(ENV_PATH, "utf8");
      if (!/^ADMIN_PASSWORD_HASH=.*$/m.test(envContent)) {
        throw new Error("ADMIN_PASSWORD_HASH missing in server/.env");
      }

      const updatedEnv = envContent.replace(
        /^ADMIN_PASSWORD_HASH=.*$/m,
        `ADMIN_PASSWORD_HASH=${newHash}`
      );
      fs.writeFileSync(ENV_PATH, updatedEnv, "utf8");

      // Invalidate the single-use OTP session immediately
      activeResetSessions.delete(resetSessionId);

      // Update in-memory hash and rotate tokenVersion (invalidates all previous admin JWTs)
      setAdminPasswordHash(newHash);

      return res.json({
        status: "success",
        message: "Admin password successfully reset. All active admin sessions have been revoked. Please log in with your new password."
      });
    } catch (error) {
      console.error("Admin forgot password reset error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Could not reset admin password."
      });
    }
  });
}

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

// Helper: mask email for display (e.g. j***n@example.com)
export function maskEmail(email) {
  if (!email || typeof email !== "string") return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const maskedLocal =
    local.length <= 2
      ? local[0] + "***"
      : local[0] + "***" + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
}

// Helper: mask phone for display (e.g. +91 ****** 4321)
export function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return "";
  const clean = phone.trim();
  if (clean.length < 6) return clean;
  return clean.slice(0, 3) + " ****** " + clean.slice(-4);
}

// Email provider configuration
export function getEmailTransporter() {
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

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  );
}

export function isSmsConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    process.env.TWILIO_PHONE_NUMBER?.trim()
  );
}

export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.VITE_GOOGLE_CLIENT_ID?.trim()
  );
}

// Generate cryptographically secure 6-digit OTP using OS CSPRNG
export function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Secure HMAC-SHA256 hash of OTP bound to sessionId, identifier, and secret
export function hashOtp(otp, sessionId, identifier, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${sessionId}:${identifier}:${otp}`)
    .digest("hex");
}

// Timing-safe comparison of OTP hashes to prevent timing attacks
export function verifyOtpHash(otp, sessionId, identifier, secret, expectedHash) {
  if (!otp || !expectedHash) return false;
  const computed = hashOtp(otp, sessionId, identifier, secret);
  if (computed.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, "utf8"),
    Buffer.from(expectedHash, "utf8")
  );
}

// Real Email Dispatch via SMTP
export async function sendCustomerEmailOtp({ to, name, otp }) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    throw new Error(
      "SMTP is not configured. Please configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM in server/.env"
    );
  }

  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim();
  const displayName = name && typeof name === "string" && name.trim() ? name.trim() : "Valued Customer";

  const mailOptions = {
    from: `"VELORA" <${from}>`,
    to,
    subject: `Your VELORA Verification Code: ${otp}`,
    text: `Hello ${displayName},\n\nYour VELORA customer verification code is: ${otp}\n\nThis security code expires in 10 minutes.\nNever share this code with anyone.\n\nWarm regards,\nThe VELORA Team`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B0B0C; color: #F5F4F0; padding: 40px 20px; text-align: center;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #141416; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 36px 28px; text-align: left; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <div style="text-align: center; margin-bottom: 28px;">
            <span style="font-size: 24px; letter-spacing: 0.35em; color: #FFFFFF; font-weight: 300;">V E L O R A</span>
            <p style="font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: #D4AF37; margin-top: 6px;">Customer Authentication</p>
          </div>
          <h2 style="font-size: 20px; font-weight: 400; color: #FFFFFF; margin: 0 0 12px 0;">Verify Your Email Address</h2>
          <p style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6; margin: 0 0 24px 0;">
            Hello ${displayName},<br>
            Please use the single-use verification code below to authenticate your VELORA customer session.
          </p>
          <div style="background-color: #1F1F24; border: 1px solid rgba(212,175,55,0.35); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 34px; font-weight: 600; letter-spacing: 0.28em; color: #D4AF37;">${otp}</span>
          </div>
          <p style="font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.5; margin: 0 0 12px 0;">
            This security code expires in <strong>10 minutes</strong> and can only be used once. If you did not initiate this request, you can safely ignore this email.
          </p>
          <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; margin-top: 20px;">
            <p style="font-size: 10px; color: rgba(255,255,255,0.4); margin: 0;">
              VELORA Security Notice: Our team will never ask for your verification code.
            </p>
          </div>
        </div>
        <p style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 24px; letter-spacing: 0.1em;">
          &copy; ${new Date().getFullYear()} VELORA Inc. &middot; The Art of Everyday Luxury
        </p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

// Real SMS Dispatch via Twilio
export async function sendCustomerSmsOtp({ phone, otp }) {
  if (!isSmsConfigured()) {
    return {
      sent: false,
      configured: false,
      message:
        "SMS provider is not configured. Required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in server/.env."
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID.trim();
  const token = process.env.TWILIO_AUTH_TOKEN.trim();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER.trim();

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: fromNumber,
    Body: `VELORA verification code: ${otp}. Valid for 10 minutes. Never share this code.`
  });

  const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `Twilio SMS dispatch failed with HTTP ${response.status}`
    );
  }

  const result = await response.json();
  return {
    sent: true,
    configured: true,
    sid: result.sid
  };
}

// Database schema initialization
export function initCustomerAuthDatabase(db) {
  // 1. Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE COLLATE NOCASE,
      phone TEXT UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      google_id TEXT UNIQUE,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_customers_google ON customers(google_id);
  `);

  // 2. Customer OTP verification sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_otp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      target_type TEXT NOT NULL CHECK (target_type IN ('email', 'mobile')),
      identifier TEXT NOT NULL,
      name TEXT,
      otp_hash TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at INTEGER NOT NULL,
      last_sent_at INTEGER NOT NULL,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_customer_otp_session_id
      ON customer_otp_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_customer_otp_identifier
      ON customer_otp_sessions(identifier);
  `);

  // 3. Customer rate limiting table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      identifier TEXT NOT NULL,
      ip_address TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_rate_limits
      ON customer_rate_limits(action, identifier, timestamp);
  `);

  // 4. Safe migration for orders table: add customer_id if not present
  try {
    const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
    if (!orderCols.includes("customer_id")) {
      db.exec("ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)");
      console.log("Safe migration: customer_id added to orders table.");
    }
  } catch (err) {
    console.error("Migration error on orders table customer_id:", err.message);
  }
}

// Customer Authenticator Middleware
export function createCustomerAuthenticator(jwtSecret) {
  return function authenticateCustomer(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "error",
        message: "Customer authentication token required."
      });
    }

    try {
      const token = authorization.slice("Bearer ".length);
      const payload = jwt.verify(token, jwtSecret, {
        issuer: "velora-api",
        audience: "velora-customers"
      });

      if (
        typeof payload !== "object" ||
        !Number.isSafeInteger(payload.customerId) ||
        payload.role !== "customer"
      ) {
        return res.status(401).json({
          status: "error",
          message: "Invalid customer authentication token."
        });
      }

      req.customer = {
        id: payload.customerId,
        role: payload.role,
        email: payload.email,
        phone: payload.phone
      };

      return next();
    } catch {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired customer authentication token."
      });
    }
  };
}

// Rate Limiting Constants & Enforcement
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR_TARGET = 5;
const MAX_REQUESTS_PER_HOUR_IP = 15;

function checkRateLimit(db, action, identifier, ipAddress) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Prune entries older than 2 hours periodically
  db.prepare("DELETE FROM customer_rate_limits WHERE timestamp < ?").run(Date.now() - 2 * 60 * 60 * 1000);

  // Check target limit (per email or phone)
  const targetCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM customer_rate_limits
    WHERE action = ? AND identifier = ? AND timestamp > ?
  `).get(action, identifier, oneHourAgo)?.count || 0;

  if (targetCount >= MAX_REQUESTS_PER_HOUR_TARGET) {
    return {
      allowed: false,
      message: "Too many requests for this account. Please wait before trying again."
    };
  }

  // Check IP limit
  if (ipAddress) {
    const ipCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM customer_rate_limits
      WHERE action = ? AND ip_address = ? AND timestamp > ?
    `).get(action, ipAddress, oneHourAgo)?.count || 0;

    if (ipCount >= MAX_REQUESTS_PER_HOUR_IP) {
      return {
        allowed: false,
        message: "Too many verification requests from your network. Please try again later."
      };
    }
  }

  return { allowed: true };
}

function recordRateLimit(db, action, identifier, ipAddress) {
  db.prepare(`
    INSERT INTO customer_rate_limits (action, identifier, ip_address, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(action, identifier, ipAddress, Date.now());
}

// Customer Auth Routes Registrar
export function registerCustomerAuthRoutes(app, db, jwtSecret) {
  initCustomerAuthDatabase(db);
  const authenticateCustomer = createCustomerAuthenticator(jwtSecret);

  // 1. GET /api/customer/auth/providers - Check active auth providers
  app.get("/api/customer/auth/providers", (req, res) => {
    return res.json({
      status: "success",
      providers: {
        email: {
          configured: isEmailConfigured(),
          provider: isEmailConfigured() ? "SMTP (" + (process.env.SMTP_HOST || "configured") + ")" : "Not configured",
          requiredEnv: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"]
        },
        sms: {
          configured: isSmsConfigured(),
          provider: isSmsConfigured() ? "Twilio SMS" : "Not configured",
          requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        },
        google: {
          configured: isGoogleConfigured(),
          provider: isGoogleConfigured() ? "Google OAuth 2.0" : "Not configured",
          requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
        }
      }
    });
  });

  // 2. POST /api/customer/auth/email/request-otp - Send Email OTP
  app.post("/api/customer/auth/email/request-otp", async (req, res) => {
    try {
      const { email, name } = req.body ?? {};

      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid email address."
        });
      }

      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid email address."
        });
      }

      if (!isEmailConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMTP_NOT_CONFIGURED",
          message: "Email delivery service is not configured. Required environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM."
        });
      }

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const rateCheck = checkRateLimit(db, "email_otp", cleanEmail, ipAddress);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          status: "error",
          message: rateCheck.message
        });
      }

      // Check existing active session for cooldown
      const existingSession = db.prepare(`
        SELECT session_id, last_sent_at, is_consumed
        FROM customer_otp_sessions
        WHERE identifier = ? AND target_type = 'email' AND is_consumed = 0
        ORDER BY id DESC LIMIT 1
      `).get(cleanEmail);

      const now = Date.now();
      if (existingSession && now - existingSession.last_sent_at < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (now - existingSession.last_sent_at)) / 1000);
        return res.status(429).json({
          status: "error",
          message: `Please wait ${remaining} seconds before requesting a new code.`,
          resendCooldown: remaining
        });
      }

      // Cryptographically secure OTP generation
      const otp = generateSecureOtp();
      const sessionId = crypto.randomUUID();
      const otpHash = hashOtp(otp, sessionId, cleanEmail, jwtSecret);
      const expiresAt = now + OTP_EXPIRY_MS;

      // Invalidate any older unconsumed sessions for this email
      db.prepare(`
        UPDATE customer_otp_sessions
        SET is_consumed = 1
        WHERE identifier = ? AND target_type = 'email' AND is_consumed = 0
      `).run(cleanEmail);

      // Store new secure session
      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed, ip_address
        ) VALUES (?, 'email', ?, ?, ?, 0, ?, ?, ?, 0, ?)
      `).run(sessionId, cleanEmail, typeof name === "string" ? name.trim() : null, otpHash, MAX_ATTEMPTS, expiresAt, now, ipAddress);

      recordRateLimit(db, "email_otp", cleanEmail, ipAddress);

      // Dispatch real email via SMTP
      await sendCustomerEmailOtp({
        to: cleanEmail,
        name: typeof name === "string" ? name.trim() : "",
        otp
      });

      // Never expose OTP in production logs or response
      console.log(`[CUSTOMER AUTH] Email OTP dispatched to ${maskEmail(cleanEmail)} (Session: ${sessionId.slice(0, 8)}...)`);

      return res.json({
        status: "success",
        message: "Verification code dispatched to your email.",
        sessionId,
        targetMasked: maskEmail(cleanEmail),
        resendCooldown: 60,
        expiresInSeconds: 600
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Email OTP request error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to send verification code. Please try again shortly."
      });
    }
  });

  // 3. POST /api/customer/auth/email/verify-otp - Verify Email OTP & Authenticate
  app.post("/api/customer/auth/email/verify-otp", (req, res) => {
    try {
      const { sessionId, otp, name } = req.body ?? {};

      if (typeof sessionId !== "string" || !sessionId.trim() || typeof otp !== "string" || !otp.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Session ID and 6-digit verification code are required."
        });
      }

      const cleanSessionId = sessionId.trim();
      const cleanOtp = otp.trim().replace(/\D/g, "");

      if (cleanOtp.length !== 6) {
        return res.status(400).json({
          status: "error",
          message: "Please enter the complete 6-digit code."
        });
      }

      const session = db.prepare(`
        SELECT * FROM customer_otp_sessions
        WHERE session_id = ? AND target_type = 'email'
      `).get(cleanSessionId);

      if (!session) {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired session. Please request a new code."
        });
      }

      // Check if already consumed (prevent reuse)
      if (session.is_consumed === 1 || !session.otp_hash) {
        return res.status(400).json({
          status: "error",
          message: "This verification code has already been used. Please request a new code."
        });
      }

      // Check expiry
      const now = Date.now();
      if (now > session.expires_at) {
        db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
        return res.status(400).json({
          status: "error",
          message: "Verification code has expired. Please request a new code."
        });
      }

      // Check maximum attempts limit (prevent brute-force)
      if (session.attempts >= session.max_attempts) {
        db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
        return res.status(429).json({
          status: "error",
          message: "Maximum verification attempts exceeded. Please request a new code."
        });
      }

      // Verify OTP hash with timing-safe comparison
      const isValid = verifyOtpHash(cleanOtp, session.session_id, session.identifier, jwtSecret, session.otp_hash);

      if (!isValid) {
        const nextAttempts = session.attempts + 1;
        db.prepare("UPDATE customer_otp_sessions SET attempts = ? WHERE id = ?").run(nextAttempts, session.id);

        const remaining = Math.max(0, session.max_attempts - nextAttempts);
        if (remaining === 0) {
          db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
          return res.status(400).json({
            status: "error",
            message: "Maximum attempts exceeded. This code has been deactivated. Please request a new code."
          });
        }

        return res.status(400).json({
          status: "error",
          message: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
          attemptsRemaining: remaining
        });
      }

      // Mark session as consumed immediately to prevent reuse
      db.prepare(`
        UPDATE customer_otp_sessions
        SET is_consumed = 1, otp_hash = NULL
        WHERE id = ?
      `).run(session.id);

      // Find or create customer record
      const cleanEmail = session.identifier.toLowerCase();
      let customer = db.prepare("SELECT * FROM customers WHERE email = ?").get(cleanEmail);

      const customerName = (typeof name === "string" && name.trim()) || session.name || (customer?.name) || cleanEmail.split("@")[0];

      if (!customer) {
        const insertResult = db.prepare(`
          INSERT INTO customers (name, email, email_verified, updated_at)
          VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        `).run(customerName, cleanEmail);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(insertResult.lastInsertRowid);
      } else {
        db.prepare(`
          UPDATE customers
          SET email_verified = 1, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(customerName, customer.id);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
      }

      // Generate customer JWT token
      const token = jwt.sign(
        {
          customerId: customer.id,
          role: "customer",
          email: customer.email,
          phone: customer.phone,
          name: customer.name
        },
        jwtSecret,
        {
          expiresIn: "30d",
          issuer: "velora-api",
          audience: "velora-customers"
        }
      );

      return res.json({
        status: "success",
        message: "Email verified successfully.",
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          email_verified: Boolean(customer.email_verified),
          phone_verified: Boolean(customer.phone_verified),
          avatar_url: customer.avatar_url
        }
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Email OTP verify error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to verify code. Please try again."
      });
    }
  });

  // 4. POST /api/customer/auth/email/resend-otp - Resend Email OTP
  app.post("/api/customer/auth/email/resend-otp", async (req, res) => {
    try {
      const { sessionId } = req.body ?? {};

      if (typeof sessionId !== "string" || !sessionId.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Session ID is required."
        });
      }

      const session = db.prepare(`
        SELECT * FROM customer_otp_sessions
        WHERE session_id = ? AND target_type = 'email'
      `).get(sessionId.trim());

      if (!session) {
        return res.status(400).json({
          status: "error",
          message: "Session not found. Please start over."
        });
      }

      const now = Date.now();
      if (now - session.last_sent_at < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (now - session.last_sent_at)) / 1000);
        return res.status(429).json({
          status: "error",
          message: `Please wait ${remaining} seconds before requesting another code.`,
          resendCooldown: remaining
        });
      }

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const rateCheck = checkRateLimit(db, "email_otp", session.identifier, ipAddress);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          status: "error",
          message: rateCheck.message
        });
      }

      // Generate new cryptographically secure OTP
      const newOtp = generateSecureOtp();
      const newHash = hashOtp(newOtp, session.session_id, session.identifier, jwtSecret);
      const newExpiresAt = now + OTP_EXPIRY_MS;

      db.prepare(`
        UPDATE customer_otp_sessions
        SET otp_hash = ?, attempts = 0, expires_at = ?, last_sent_at = ?, is_consumed = 0
        WHERE id = ?
      `).run(newHash, newExpiresAt, now, session.id);

      recordRateLimit(db, "email_otp", session.identifier, ipAddress);

      await sendCustomerEmailOtp({
        to: session.identifier,
        name: session.name || "",
        otp: newOtp
      });

      console.log(`[CUSTOMER AUTH] Email OTP resent to ${maskEmail(session.identifier)}`);

      return res.json({
        status: "success",
        message: "A new verification code has been dispatched to your email.",
        resendCooldown: 60,
        expiresInSeconds: 600
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Resend email OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to resend verification code."
      });
    }
  });

  // 5. POST /api/customer/auth/mobile/request-otp - Send Mobile OTP
  app.post("/api/customer/auth/mobile/request-otp", async (req, res) => {
    try {
      const { phone, name } = req.body ?? {};

      if (typeof phone !== "string" || !phone.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid mobile number."
        });
      }

      const cleanPhone = phone.trim().replace(/[\s\-()]/g, "");
      if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid mobile number with country code (e.g. +91 98765 43210)."
        });
      }

      // Check if SMS provider is configured
      if (!isSmsConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMS_NOT_CONFIGURED",
          message: "SMS delivery service is not configured. Required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.",
          requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        });
      }

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const rateCheck = checkRateLimit(db, "mobile_otp", cleanPhone, ipAddress);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          status: "error",
          message: rateCheck.message
        });
      }

      // Check cooldown on existing session
      const existingSession = db.prepare(`
        SELECT session_id, last_sent_at, is_consumed
        FROM customer_otp_sessions
        WHERE identifier = ? AND target_type = 'mobile' AND is_consumed = 0
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone);

      const now = Date.now();
      if (existingSession && now - existingSession.last_sent_at < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (now - existingSession.last_sent_at)) / 1000);
        return res.status(429).json({
          status: "error",
          message: `Please wait ${remaining} seconds before requesting another SMS code.`,
          resendCooldown: remaining
        });
      }

      // Cryptographically secure OTP generation
      const otp = generateSecureOtp();
      const sessionId = crypto.randomUUID();
      const otpHash = hashOtp(otp, sessionId, cleanPhone, jwtSecret);
      const expiresAt = now + OTP_EXPIRY_MS;

      // Invalidate earlier unconsumed sessions
      db.prepare(`
        UPDATE customer_otp_sessions
        SET is_consumed = 1
        WHERE identifier = ? AND target_type = 'mobile' AND is_consumed = 0
      `).run(cleanPhone);

      // Store new session
      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed, ip_address
        ) VALUES (?, 'mobile', ?, ?, ?, 0, ?, ?, ?, 0, ?)
      `).run(sessionId, cleanPhone, typeof name === "string" ? name.trim() : null, otpHash, MAX_ATTEMPTS, expiresAt, now, ipAddress);

      recordRateLimit(db, "mobile_otp", cleanPhone, ipAddress);

      // Dispatch real SMS via Twilio
      await sendCustomerSmsOtp({
        phone: cleanPhone,
        otp
      });

      console.log(`[CUSTOMER AUTH] Mobile OTP dispatched to ${maskPhone(cleanPhone)} (Session: ${sessionId.slice(0, 8)}...)`);

      return res.json({
        status: "success",
        message: "Verification code dispatched to your mobile number.",
        sessionId,
        targetMasked: maskPhone(cleanPhone),
        resendCooldown: 60,
        expiresInSeconds: 600
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Mobile OTP request error:", error.message);
      return res.status(500).json({
        status: "error",
        message: error.message || "Failed to dispatch mobile verification code."
      });
    }
  });

  // 6. POST /api/customer/auth/mobile/verify-otp - Verify Mobile OTP & Authenticate
  app.post("/api/customer/auth/mobile/verify-otp", (req, res) => {
    try {
      const { sessionId, otp, name } = req.body ?? {};

      if (typeof sessionId !== "string" || !sessionId.trim() || typeof otp !== "string" || !otp.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Session ID and 6-digit verification code are required."
        });
      }

      const cleanSessionId = sessionId.trim();
      const cleanOtp = otp.trim().replace(/\D/g, "");

      if (cleanOtp.length !== 6) {
        return res.status(400).json({
          status: "error",
          message: "Please enter the complete 6-digit code."
        });
      }

      const session = db.prepare(`
        SELECT * FROM customer_otp_sessions
        WHERE session_id = ? AND target_type = 'mobile'
      `).get(cleanSessionId);

      if (!session) {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired session. Please request a new code."
        });
      }

      // Check if already consumed (prevent reuse)
      if (session.is_consumed === 1 || !session.otp_hash) {
        return res.status(400).json({
          status: "error",
          message: "This verification code has already been used. Please request a new code."
        });
      }

      // Check expiry
      const now = Date.now();
      if (now > session.expires_at) {
        db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
        return res.status(400).json({
          status: "error",
          message: "Verification code has expired. Please request a new code."
        });
      }

      // Check maximum verification attempts
      if (session.attempts >= session.max_attempts) {
        db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
        return res.status(429).json({
          status: "error",
          message: "Maximum verification attempts exceeded. Please request a new code."
        });
      }

      // Verify OTP hash with timing-safe comparison
      const isValid = verifyOtpHash(cleanOtp, session.session_id, session.identifier, jwtSecret, session.otp_hash);

      if (!isValid) {
        const nextAttempts = session.attempts + 1;
        db.prepare("UPDATE customer_otp_sessions SET attempts = ? WHERE id = ?").run(nextAttempts, session.id);

        const remaining = Math.max(0, session.max_attempts - nextAttempts);
        if (remaining === 0) {
          db.prepare("UPDATE customer_otp_sessions SET is_consumed = 1 WHERE id = ?").run(session.id);
          return res.status(400).json({
            status: "error",
            message: "Maximum attempts exceeded. This code has been deactivated. Please request a new code."
          });
        }

        return res.status(400).json({
          status: "error",
          message: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
          attemptsRemaining: remaining
        });
      }

      // Mark consumed immediately
      db.prepare(`
        UPDATE customer_otp_sessions
        SET is_consumed = 1, otp_hash = NULL
        WHERE id = ?
      `).run(session.id);

      // Find or create customer record by phone
      const cleanPhone = session.identifier;
      let customer = db.prepare("SELECT * FROM customers WHERE phone = ?").get(cleanPhone);

      const customerName = (typeof name === "string" && name.trim()) || session.name || (customer?.name) || `Customer ${cleanPhone.slice(-4)}`;

      if (!customer) {
        const insertResult = db.prepare(`
          INSERT INTO customers (name, phone, phone_verified, updated_at)
          VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        `).run(customerName, cleanPhone);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(insertResult.lastInsertRowid);
      } else {
        db.prepare(`
          UPDATE customers
          SET phone_verified = 1, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(customerName, customer.id);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
      }

      // Generate customer JWT token
      const token = jwt.sign(
        {
          customerId: customer.id,
          role: "customer",
          email: customer.email,
          phone: customer.phone,
          name: customer.name
        },
        jwtSecret,
        {
          expiresIn: "30d",
          issuer: "velora-api",
          audience: "velora-customers"
        }
      );

      return res.json({
        status: "success",
        message: "Mobile number verified successfully.",
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          email_verified: Boolean(customer.email_verified),
          phone_verified: Boolean(customer.phone_verified),
          avatar_url: customer.avatar_url
        }
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Mobile OTP verify error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to verify mobile code."
      });
    }
  });

  // 7. POST /api/customer/auth/mobile/resend-otp - Resend Mobile OTP
  app.post("/api/customer/auth/mobile/resend-otp", async (req, res) => {
    try {
      const { sessionId } = req.body ?? {};

      if (typeof sessionId !== "string" || !sessionId.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Session ID is required."
        });
      }

      const session = db.prepare(`
        SELECT * FROM customer_otp_sessions
        WHERE session_id = ? AND target_type = 'mobile'
      `).get(sessionId.trim());

      if (!session) {
        return res.status(400).json({
          status: "error",
          message: "Session not found. Please start over."
        });
      }

      if (!isSmsConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMS_NOT_CONFIGURED",
          message: "SMS provider is not configured.",
          requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        });
      }

      const now = Date.now();
      if (now - session.last_sent_at < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (now - session.last_sent_at)) / 1000);
        return res.status(429).json({
          status: "error",
          message: `Please wait ${remaining} seconds before requesting another SMS code.`,
          resendCooldown: remaining
        });
      }

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const rateCheck = checkRateLimit(db, "mobile_otp", session.identifier, ipAddress);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          status: "error",
          message: rateCheck.message
        });
      }

      const newOtp = generateSecureOtp();
      const newHash = hashOtp(newOtp, session.session_id, session.identifier, jwtSecret);
      const newExpiresAt = now + OTP_EXPIRY_MS;

      db.prepare(`
        UPDATE customer_otp_sessions
        SET otp_hash = ?, attempts = 0, expires_at = ?, last_sent_at = ?, is_consumed = 0
        WHERE id = ?
      `).run(newHash, newExpiresAt, now, session.id);

      recordRateLimit(db, "mobile_otp", session.identifier, ipAddress);

      await sendCustomerSmsOtp({
        phone: session.identifier,
        otp: newOtp
      });

      console.log(`[CUSTOMER AUTH] Mobile OTP resent to ${maskPhone(session.identifier)}`);

      return res.json({
        status: "success",
        message: "A new SMS verification code has been dispatched.",
        resendCooldown: 60,
        expiresInSeconds: 600
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Resend mobile OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: error.message || "Failed to resend SMS verification code."
      });
    }
  });

  // 8. POST /api/customer/auth/google - Customer Google OAuth 2.0
  app.post("/api/customer/auth/google", async (req, res) => {
    try {
      const { idToken } = req.body ?? {};

      if (!idToken || typeof idToken !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Google ID token is required."
        });
      }

      const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
      const googleRes = await fetch(verifyUrl);

      if (!googleRes.ok) {
        return res.status(401).json({
          status: "error",
          message: "Invalid or expired Google token."
        });
      }

      const payload = await googleRes.json();
      const expectedClientId = process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim();

      if (expectedClientId && payload.aud !== expectedClientId) {
        return res.status(401).json({
          status: "error",
          message: "Google token audience mismatch."
        });
      }

      const googleId = payload.sub;
      const email = payload.email?.toLowerCase();
      const name = payload.name || payload.email?.split("@")[0] || "Customer";
      const avatarUrl = payload.picture || null;

      if (!email) {
        return res.status(400).json({
          status: "error",
          message: "Google profile does not contain an email address."
        });
      }

      // Check for existing customer by google_id or email
      let customer = db.prepare("SELECT * FROM customers WHERE google_id = ? OR email = ?").get(googleId, email);

      if (!customer) {
        const insert = db.prepare(`
          INSERT INTO customers (name, email, google_id, email_verified, avatar_url, updated_at)
          VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
        `).run(name, email, googleId, avatarUrl);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(insert.lastInsertRowid);
      } else {
        db.prepare(`
          UPDATE customers
          SET google_id = COALESCE(google_id, ?),
              email_verified = 1,
              avatar_url = COALESCE(?, avatar_url),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(googleId, avatarUrl, customer.id);

        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
      }

      const token = jwt.sign(
        {
          customerId: customer.id,
          role: "customer",
          email: customer.email,
          phone: customer.phone,
          name: customer.name
        },
        jwtSecret,
        {
          expiresIn: "30d",
          issuer: "velora-api",
          audience: "velora-customers"
        }
      );

      return res.json({
        status: "success",
        message: "Google sign-in successful.",
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          email_verified: Boolean(customer.email_verified),
          phone_verified: Boolean(customer.phone_verified),
          avatar_url: customer.avatar_url
        }
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Google auth error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Google sign-in failed. Please try again."
      });
    }
  });

  // 9. GET /api/customer/auth/me - Get Current Customer Profile & Orders
  app.get("/api/customer/auth/me", authenticateCustomer, (req, res) => {
    try {
      const customer = db.prepare(`
        SELECT id, name, email, phone, email_verified, phone_verified, avatar_url, created_at
        FROM customers
        WHERE id = ?
      `).get(req.customer.id);

      if (!customer) {
        return res.status(404).json({
          status: "error",
          message: "Customer profile not found."
        });
      }

      // Fetch customer orders (matched by customer_id or email)
      const orders = db.prepare(`
        SELECT id, customer_name, email, total, status, payment_status, tracking_number, courier_name, created_at, items
        FROM orders
        WHERE customer_id = ? OR (email = ? AND email IS NOT NULL AND email != '')
        ORDER BY id DESC
      `).all(customer.id, customer.email || "");

      const formattedOrders = orders.map((o) => {
        let items = [];
        try {
          items = JSON.parse(o.items);
        } catch {
          items = [];
        }
        return {
          ...o,
          items
        };
      });

      return res.json({
        status: "success",
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          email_verified: Boolean(customer.email_verified),
          phone_verified: Boolean(customer.phone_verified),
          avatar_url: customer.avatar_url,
          created_at: customer.created_at
        },
        orders: formattedOrders
      });
    } catch (error) {
      console.error("[CUSTOMER AUTH] Profile fetch error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Could not retrieve profile."
      });
    }
  });

  // 10. POST /api/customer/auth/logout - Logout
  app.post("/api/customer/auth/logout", authenticateCustomer, (req, res) => {
    return res.json({
      status: "success",
      message: "Customer logged out successfully."
    });
  });
}

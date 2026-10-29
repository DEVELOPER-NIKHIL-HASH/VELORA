import crypto from "node:crypto";
import bcrypt from "bcryptjs";
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
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

// Generate cryptographically secure 6-digit OTP
export function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Secure hash of OTP bound to sessionToken and secret
export function hashOtp(otp, sessionToken, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${sessionToken}:${otp}`)
    .digest("hex");
}

// Timing-safe comparison of OTP hashes
export function verifyOtpHash(otp, sessionToken, secret, expectedHash) {
  if (!otp || !expectedHash) return false;
  const computed = hashOtp(otp, sessionToken, secret);
  if (computed.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, "utf8"),
    Buffer.from(expectedHash, "utf8")
  );
}

// Real Email Dispatch
export async function sendEmailOtp({ to, name, otp }) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    throw new Error(
      "SMTP is not configured. Please configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM in server/.env"
    );
  }

  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim();

  const mailOptions = {
    from: `"VELORA Atelier" <${from}>`,
    to,
    subject: "Your VELORA Seller Verification Code",
    text: `Hello ${name},\n\nYour 6-digit verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nWelcome to VELORA,\nThe VELORA Team`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B0B0C; color: #F5F4F0; padding: 40px 20px; text-align: center;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #141416; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 36px 28px; text-align: left;">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="font-size: 22px; letter-spacing: 0.35em; color: #FFFFFF; font-weight: 300;">V E L O R A</span>
            <p style="font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: #D4AF37; margin-top: 6px;">Atelier Verification</p>
          </div>
          <h2 style="font-size: 20px; font-weight: 400; color: #FFFFFF; margin: 0 0 12px 0;">Verify Your Email Address</h2>
          <p style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6; margin: 0 0 24px 0;">
            Hello ${name},<br>
            Use the verification code below to verify your email address and continue establishing your seller account.
          </p>
          <div style="background-color: #1F1F24; border: 1px solid rgba(212,175,55,0.3); border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 600; letter-spacing: 0.25em; color: #D4AF37;">${otp}</span>
          </div>
          <p style="font-size: 11px; color: rgba(255,255,255,0.45); line-height: 1.5; margin: 0;">
            This security code expires in <strong>10 minutes</strong>. If you did not initiate this request, you can safely disregard this email.
          </p>
        </div>
        <p style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 24px; letter-spacing: 0.1em;">
          &copy; 2026 VELORA Inc. &middot; The Art of Everyday Luxury
        </p>
      </div>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

// Real SMS Dispatch via Twilio
export async function sendSmsOtp({ phone, otp }) {
  if (!isSmsConfigured()) {
    return {
      sent: false,
      configured: false,
      message:
        "SMS provider is not configured. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in server/.env."
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID.trim();
  const token = process.env.TWILIO_AUTH_TOKEN.trim();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER.trim();

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: fromNumber,
    Body: `VELORA Atelier verification code: ${otp}. Valid for 10 minutes. Do not share this code.`
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

// Real Welcome Email Dispatch
export async function sendWelcomeEmail({ to, name }) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    return { sent: false, reason: "SMTP not configured" };
  }

  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim();

  const mailOptions = {
    from: `"VELORA Atelier" <${from}>`,
    to,
    subject: "Welcome to VELORA",
    text: `Hello ${name},\n\nWelcome to VELORA. Your seller account has been successfully created and verified.\n\nYou can access your workspace anytime at: http://localhost:5173/seller\n\nSincerely,\nThe VELORA Team`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B0B0C; color: #F5F4F0; padding: 40px 20px; text-align: center;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #141416; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 36px 28px; text-align: left;">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="font-size: 24px; letter-spacing: 0.35em; color: #FFFFFF; font-weight: 300;">V E L O R A</span>
            <p style="font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: #D4AF37; margin-top: 6px;">Partner Atelier Confirmed</p>
          </div>
          <h2 style="font-size: 22px; font-weight: 400; color: #FFFFFF; margin: 0 0 14px 0;">Welcome to VELORA, ${name}.</h2>
          <p style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6; margin: 0 0 24px 0;">
            Your seller atelier account is officially verified and activated. You now have complete access to list curated products, monitor orders, and manage your bespoke commerce presence.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="http://localhost:5173/seller" style="display: inline-block; background-color: #D4AF37; color: #000000; text-decoration: none; padding: 14px 32px; border-radius: 9999px; font-size: 12px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase;">
              Open Seller Workspace &rarr;
            </a>
          </div>
          <p style="font-size: 11px; color: rgba(255,255,255,0.45); line-height: 1.5; margin: 0;">
            If you need assistance configuring your store or setting up products, our partner support atelier is at your service.
          </p>
        </div>
        <p style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 24px; letter-spacing: 0.1em;">
          &copy; 2026 VELORA Inc. &middot; The Art of Everyday Luxury
        </p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error("Welcome email dispatch failed:", error.message);
    return { sent: false, error: error.message };
  }
}

// Database schema initialization
export function initializeSellerRegistrationSchema(db) {
  // Safe column migration on users table
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);

  if (!userColumns.includes("phone")) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }
  if (!userColumns.includes("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.includes("phone_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.includes("google_id")) {
    db.exec("ALTER TABLE users ADD COLUMN google_id TEXT");
  }

  // Create persistent seller verification sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      store_name TEXT NOT NULL,
      store_slug TEXT NOT NULL,
      email_otp_hash TEXT,
      email_otp_expires_at INTEGER,
      email_otp_attempts INTEGER DEFAULT 0,
      email_otp_last_sent_at INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      phone_otp_hash TEXT,
      phone_otp_expires_at INTEGER,
      phone_otp_attempts INTEGER DEFAULT 0,
      phone_otp_last_sent_at INTEGER DEFAULT 0,
      phone_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_seller_verifications_token
      ON seller_verifications(session_token);
  `);
}

// Main route registrar
export function registerSellerRegistrationRoutes(app, db, jwtSecret) {
  initializeSellerRegistrationSchema(db);

  // Status check for external providers (Email, SMS, Google)
  app.get("/api/auth/seller/provider-status", (req, res) => {
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

  // Step 1: Initiate Seller Registration
  app.post("/api/auth/seller/initiate", async (req, res) => {
    try {
      const { name, email, phone, password, storeName } = req.body ?? {};

      if (
        typeof name !== "string" ||
        typeof email !== "string" ||
        typeof phone !== "string" ||
        typeof password !== "string"
      ) {
        return res.status(400).json({
          status: "error",
          message: "Full name, email address, mobile number, and password are required."
        });
      }

      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, "");

      if (!cleanName || cleanName.length > 100) {
        return res.status(400).json({
          status: "error",
          message: "Full name must be between 1 and 100 characters."
        });
      }

      if (
        cleanEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
      ) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid email address."
        });
      }

      if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid mobile number (10 to 15 digits, e.g. +919876543210)."
        });
      }

      if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({
          status: "error",
          message: "Password must be at least 8 characters long."
        });
      }

      // Check existing email
      const existingUserByEmail = db.prepare(
        "SELECT id FROM users WHERE email = ? COLLATE NOCASE"
      ).get(cleanEmail);

      if (existingUserByEmail) {
        return res.status(409).json({
          status: "error",
          message: "An account with this email address is already registered."
        });
      }

      // Check existing phone
      const existingUserByPhone = db.prepare(
        "SELECT id FROM users WHERE phone = ?"
      ).get(cleanPhone);

      if (existingUserByPhone) {
        return res.status(409).json({
          status: "error",
          message: "An account with this mobile number is already registered."
        });
      }

      const resolvedStoreName =
        typeof storeName === "string" && storeName.trim()
          ? storeName.trim()
          : `${cleanName}'s Atelier`;

      // Auto-generate clean slug
      const baseSlug = resolvedStoreName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "atelier";

      const uniqueSuffix = crypto.randomBytes(3).toString("hex");
      const cleanSlug = `${baseSlug}-${uniqueSuffix}`;

      // Check if SMTP is configured before proceeding
      if (!isEmailConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMTP_NOT_CONFIGURED",
          message:
            "REAL email delivery is not configured on this server. Please add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM in server/.env.",
          requiredEnv: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"]
        });
      }

      // Hash password
      const passwordHash = bcrypt.hashSync(password, 12);

      // Generate session token and 6-digit OTP
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const emailOtp = generateSecureOtp();
      const emailOtpHashed = hashOtp(emailOtp, sessionToken, jwtSecret);

      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
      const now = Date.now();

      // Clean up any stale sessions for this email or phone
      db.prepare(
        "DELETE FROM seller_verifications WHERE email = ? OR phone = ?"
      ).run(cleanEmail, cleanPhone);

      // Save verification session
      db.prepare(`
        INSERT INTO seller_verifications (
          session_token,
          name,
          email,
          phone,
          password_hash,
          store_name,
          store_slug,
          email_otp_hash,
          email_otp_expires_at,
          email_otp_attempts,
          email_otp_last_sent_at,
          email_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
      `).run(
        sessionToken,
        cleanName,
        cleanEmail,
        cleanPhone,
        passwordHash,
        resolvedStoreName,
        cleanSlug,
        emailOtpHashed,
        expiresAt,
        now
      );

      // Send real email OTP
      try {
        await sendEmailOtp({
          to: cleanEmail,
          name: cleanName,
          otp: emailOtp
        });
      } catch (mailErr) {
        console.error("Failed to dispatch real email OTP:", mailErr.message);
        // Rollback verification session if email fails to send
        db.prepare("DELETE FROM seller_verifications WHERE session_token = ?").run(sessionToken);

        return res.status(500).json({
          status: "error",
          code: "EMAIL_DISPATCH_FAILED",
          message: `Email delivery failed: ${mailErr.message}. Ensure SMTP credentials in server/.env are valid.`
        });
      }

      return res.status(200).json({
        status: "success",
        sessionToken,
        step: "EMAIL_VERIFICATION",
        emailMasked: maskEmail(cleanEmail),
        phoneMasked: maskPhone(cleanPhone),
        resendCooldown: 60,
        message: `A 6-digit verification code has been dispatched to ${maskEmail(cleanEmail)}.`
      });
    } catch (error) {
      console.error("Initiate seller registration error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "An internal error occurred while processing registration."
      });
    }
  });

  // Step 2: Verify Email OTP
  app.post("/api/auth/seller/verify-email-otp", async (req, res) => {
    try {
      const { sessionToken, otp } = req.body ?? {};

      if (!sessionToken || typeof sessionToken !== "string" || !otp || typeof otp !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Session token and 6-digit OTP code are required."
        });
      }

      const cleanOtp = otp.trim();
      const session = db.prepare(
        "SELECT * FROM seller_verifications WHERE session_token = ?"
      ).get(sessionToken);

      if (!session) {
        return res.status(404).json({
          status: "error",
          message: "Registration session has expired or is invalid. Please start again."
        });
      }

      if (session.email_verified === 1) {
        return res.status(200).json({
          status: "success",
          sessionToken,
          step: "MOBILE_VERIFICATION",
          message: "Email is already verified."
        });
      }

      // Check expiration
      if (Date.now() > session.email_otp_expires_at) {
        return res.status(400).json({
          status: "error",
          code: "OTP_EXPIRED",
          message: "Verification code has expired. Please request a new code."
        });
      }

      // Check max attempts
      if (session.email_otp_attempts >= 5) {
        db.prepare("DELETE FROM seller_verifications WHERE id = ?").run(session.id);
        return res.status(429).json({
          status: "error",
          code: "MAX_ATTEMPTS_EXCEEDED",
          message: "Maximum incorrect verification attempts exceeded. Please restart registration."
        });
      }

      // Validate hash
      const isValid = verifyOtpHash(cleanOtp, sessionToken, jwtSecret, session.email_otp_hash);

      if (!isValid) {
        const nextAttempts = session.email_otp_attempts + 1;
        db.prepare(
          "UPDATE seller_verifications SET email_otp_attempts = ? WHERE id = ?"
        ).run(nextAttempts, session.id);

        const remaining = 5 - nextAttempts;
        return res.status(400).json({
          status: "error",
          code: "INVALID_OTP",
          message: `Invalid verification code. ${remaining} attempt(s) remaining.`
        });
      }

      // Mark email verified
      const phoneOtp = generateSecureOtp();
      const phoneOtpHashed = hashOtp(phoneOtp, sessionToken, jwtSecret);
      const phoneExpiresAt = Date.now() + 10 * 60 * 1000;
      const now = Date.now();

      db.prepare(`
        UPDATE seller_verifications
        SET email_verified = 1,
            phone_otp_hash = ?,
            phone_otp_expires_at = ?,
            phone_otp_attempts = 0,
            phone_otp_last_sent_at = ?
        WHERE id = ?
      `).run(phoneOtpHashed, phoneExpiresAt, now, session.id);

      // Attempt real SMS if configured
      let smsResult = { sent: false, configured: isSmsConfigured() };

      if (isSmsConfigured()) {
        try {
          const dispatched = await sendSmsOtp({
            phone: session.phone,
            otp: phoneOtp
          });
          smsResult = { sent: dispatched.sent, configured: true };
        } catch (smsErr) {
          console.error("SMS dispatch error:", smsErr.message);
          smsResult = { sent: false, configured: true, error: smsErr.message };
        }
      }

      return res.status(200).json({
        status: "success",
        sessionToken,
        step: "MOBILE_VERIFICATION",
        emailVerified: true,
        phoneMasked: maskPhone(session.phone),
        resendCooldown: 60,
        smsConfigured: smsResult.configured,
        smsSent: smsResult.sent,
        message: smsResult.configured
          ? smsResult.sent
            ? `Email verified. A mobile verification SMS has been sent to ${maskPhone(session.phone)}.`
            : `Email verified, but SMS dispatch encountered an error: ${smsResult.error || "SMS provider error"}`
          : "Email verified. Note: SMS provider credentials (Twilio) are not yet configured in server/.env."
      });
    } catch (error) {
      console.error("Verify email OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "An internal error occurred while verifying OTP."
      });
    }
  });

  // Step 3: Verify Mobile OTP & Finalize Account Creation
  app.post("/api/auth/seller/verify-mobile-otp", async (req, res) => {
    try {
      const { sessionToken, otp } = req.body ?? {};

      if (!sessionToken || typeof sessionToken !== "string" || !otp || typeof otp !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Session token and mobile OTP code are required."
        });
      }

      const cleanOtp = otp.trim();
      const session = db.prepare(
        "SELECT * FROM seller_verifications WHERE session_token = ?"
      ).get(sessionToken);

      if (!session) {
        return res.status(404).json({
          status: "error",
          message: "Registration session has expired or is invalid."
        });
      }

      if (session.email_verified !== 1) {
        return res.status(403).json({
          status: "error",
          message: "Email verification must be completed first."
        });
      }

      if (!isSmsConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMS_NOT_CONFIGURED",
          message:
            "REAL SMS provider (Twilio) is not configured in server/.env. Please configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to verify mobile numbers.",
          requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        });
      }

      if (Date.now() > session.phone_otp_expires_at) {
        return res.status(400).json({
          status: "error",
          code: "OTP_EXPIRED",
          message: "Mobile verification code has expired. Please request a new code."
        });
      }

      if (session.phone_otp_attempts >= 5) {
        db.prepare("DELETE FROM seller_verifications WHERE id = ?").run(session.id);
        return res.status(429).json({
          status: "error",
          code: "MAX_ATTEMPTS_EXCEEDED",
          message: "Maximum incorrect verification attempts exceeded."
        });
      }

      const isValid = verifyOtpHash(cleanOtp, sessionToken, jwtSecret, session.phone_otp_hash);

      if (!isValid) {
        const nextAttempts = session.phone_otp_attempts + 1;
        db.prepare(
          "UPDATE seller_verifications SET phone_otp_attempts = ? WHERE id = ?"
        ).run(nextAttempts, session.id);

        const remaining = 5 - nextAttempts;
        return res.status(400).json({
          status: "error",
          code: "INVALID_OTP",
          message: `Invalid mobile verification code. ${remaining} attempt(s) remaining.`
        });
      }

      // Both Email & Mobile are VERIFIED! Create the seller account in a database transaction
      const createSeller = db.transaction(() => {
        const userResult = db.prepare(`
          INSERT INTO users (
            name,
            email,
            phone,
            password_hash,
            role,
            email_verified,
            phone_verified
          ) VALUES (?, ?, ?, ?, 'seller', 1, 1)
        `).run(
          session.name,
          session.email,
          session.phone,
          session.password_hash
        );

        const storeResult = db.prepare(`
          INSERT INTO stores (owner_user_id, name, slug)
          VALUES (?, ?, ?)
        `).run(userResult.lastInsertRowid, session.store_name, session.store_slug);

        // Delete used verification session
        db.prepare("DELETE FROM seller_verifications WHERE id = ?").run(session.id);

        return {
          userId: Number(userResult.lastInsertRowid),
          storeId: Number(storeResult.lastInsertRowid)
        };
      });

      const created = createSeller();

      // Sign JWT token
      const token = jwt.sign(
        { userId: created.userId, role: "seller" },
        jwtSecret,
        {
          expiresIn: "7d",
          issuer: "velora-api",
          audience: "velora-sellers"
        }
      );

      // Send real welcome email asynchronously
      sendWelcomeEmail({
        to: session.email,
        name: session.name
      }).catch((e) => console.error("Welcome email background error:", e.message));

      return res.status(201).json({
        status: "success",
        step: "COMPLETE",
        message: "Seller account successfully verified and created.",
        token,
        seller: {
          id: created.userId,
          name: session.name,
          email: session.email,
          phone: session.phone,
          role: "seller"
        },
        store: {
          id: created.storeId,
          name: session.store_name,
          slug: session.store_slug
        }
      });
    } catch (error) {
      console.error("Verify mobile OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "An internal error occurred while finalizing account."
      });
    }
  });

  // Resend Email OTP
  app.post("/api/auth/seller/resend-email-otp", async (req, res) => {
    try {
      const { sessionToken } = req.body ?? {};

      if (!sessionToken || typeof sessionToken !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Session token is required."
        });
      }

      const session = db.prepare(
        "SELECT * FROM seller_verifications WHERE session_token = ?"
      ).get(sessionToken);

      if (!session) {
        return res.status(404).json({
          status: "error",
          message: "Session not found or expired."
        });
      }

      const elapsed = Date.now() - (session.email_otp_last_sent_at || 0);
      if (elapsed < 60 * 1000) {
        const remainingSeconds = Math.ceil((60 * 1000 - elapsed) / 1000);
        return res.status(429).json({
          status: "error",
          code: "COOLDOWN_ACTIVE",
          message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
          retryAfter: remainingSeconds
        });
      }

      if (!isEmailConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMTP_NOT_CONFIGURED",
          message: "SMTP is not configured in server/.env."
        });
      }

      const newOtp = generateSecureOtp();
      const newOtpHashed = hashOtp(newOtp, sessionToken, jwtSecret);
      const newExpiresAt = Date.now() + 10 * 60 * 1000;
      const now = Date.now();

      db.prepare(`
        UPDATE seller_verifications
        SET email_otp_hash = ?,
            email_otp_expires_at = ?,
            email_otp_attempts = 0,
            email_otp_last_sent_at = ?
        WHERE id = ?
      `).run(newOtpHashed, newExpiresAt, now, session.id);

      await sendEmailOtp({
        to: session.email,
        name: session.name,
        otp: newOtp
      });

      return res.status(200).json({
        status: "success",
        resendCooldown: 60,
        message: `A new verification code has been dispatched to ${maskEmail(session.email)}.`
      });
    } catch (error) {
      console.error("Resend email OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to resend email code."
      });
    }
  });

  // Resend Mobile OTP
  app.post("/api/auth/seller/resend-mobile-otp", async (req, res) => {
    try {
      const { sessionToken } = req.body ?? {};

      if (!sessionToken || typeof sessionToken !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Session token is required."
        });
      }

      const session = db.prepare(
        "SELECT * FROM seller_verifications WHERE session_token = ?"
      ).get(sessionToken);

      if (!session || session.email_verified !== 1) {
        return res.status(404).json({
          status: "error",
          message: "Invalid session or email not yet verified."
        });
      }

      const elapsed = Date.now() - (session.phone_otp_last_sent_at || 0);
      if (elapsed < 60 * 1000) {
        const remainingSeconds = Math.ceil((60 * 1000 - elapsed) / 1000);
        return res.status(429).json({
          status: "error",
          code: "COOLDOWN_ACTIVE",
          message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
          retryAfter: remainingSeconds
        });
      }

      if (!isSmsConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "SMS_NOT_CONFIGURED",
          message: "SMS provider credentials are not configured in server/.env."
        });
      }

      const newOtp = generateSecureOtp();
      const newOtpHashed = hashOtp(newOtp, sessionToken, jwtSecret);
      const newExpiresAt = Date.now() + 10 * 60 * 1000;
      const now = Date.now();

      db.prepare(`
        UPDATE seller_verifications
        SET phone_otp_hash = ?,
            phone_otp_expires_at = ?,
            phone_otp_attempts = 0,
            phone_otp_last_sent_at = ?
        WHERE id = ?
      `).run(newOtpHashed, newExpiresAt, now, session.id);

      await sendSmsOtp({
        phone: session.phone,
        otp: newOtp
      });

      return res.status(200).json({
        status: "success",
        resendCooldown: 60,
        message: `A new mobile code has been dispatched to ${maskPhone(session.phone)}.`
      });
    } catch (error) {
      console.error("Resend mobile OTP error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to resend SMS code."
      });
    }
  });

  // Google OAuth Login / Registration Endpoint
  app.post("/api/auth/seller/google", async (req, res) => {
    try {
      if (!isGoogleConfigured()) {
        return res.status(503).json({
          status: "error",
          code: "GOOGLE_NOT_CONFIGURED",
          message:
            "Google OAuth is not configured on this server. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env.",
          requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
        });
      }

      const { idToken } = req.body ?? {};
      if (!idToken || typeof idToken !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Google ID token is required."
        });
      }

      // Verify Google token via Google's tokeninfo API
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );

      if (!verifyRes.ok) {
        return res.status(401).json({
          status: "error",
          message: "Invalid Google ID token."
        });
      }

      const payload = await verifyRes.json();

      if (payload.aud !== process.env.GOOGLE_CLIENT_ID?.trim()) {
        return res.status(401).json({
          status: "error",
          message: "Google ID token audience mismatch."
        });
      }

      const googleId = payload.sub;
      const email = payload.email?.toLowerCase();
      const name = payload.name || "Google Seller";

      if (!email) {
        return res.status(400).json({
          status: "error",
          message: "Google account does not have a verified email."
        });
      }

      // Check existing user by google_id or email
      let user = db.prepare(
        "SELECT id, name, email, role FROM users WHERE google_id = ? OR email = ? COLLATE NOCASE"
      ).get(googleId, email);

      let store;

      if (!user) {
        // Create user & store
        const baseSlug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "atelier";
        const cleanSlug = `${baseSlug}-${crypto.randomBytes(3).toString("hex")}`;
        const randomPassword = crypto.randomBytes(24).toString("hex");
        const passwordHash = bcrypt.hashSync(randomPassword, 12);

        const registerGoogleUser = db.transaction(() => {
          const uRes = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, email_verified, google_id)
            VALUES (?, ?, ?, 'seller', 1, ?)
          `).run(name, email, passwordHash, googleId);

          const sRes = db.prepare(`
            INSERT INTO stores (owner_user_id, name, slug)
            VALUES (?, ?, ?)
          `).run(uRes.lastInsertRowid, `${name}'s Atelier`, cleanSlug);

          return {
            userId: Number(uRes.lastInsertRowid),
            storeId: Number(sRes.lastInsertRowid),
            storeName: `${name}'s Atelier`,
            storeSlug: cleanSlug
          };
        });

        const created = registerGoogleUser();
        user = { id: created.userId, name, email, role: "seller" };
        store = { id: created.storeId, name: created.storeName, slug: created.storeSlug };
      } else {
        // Ensure google_id is updated if they previously registered by email
        db.prepare(
          "UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?"
        ).run(googleId, user.id);

        store = db.prepare(
          "SELECT id, name, slug FROM stores WHERE owner_user_id = ? LIMIT 1"
        ).get(user.id);
      }

      const token = jwt.sign(
        { userId: user.id, role: "seller" },
        jwtSecret,
        {
          expiresIn: "7d",
          issuer: "velora-api",
          audience: "velora-sellers"
        }
      );

      return res.status(200).json({
        status: "success",
        token,
        seller: user,
        store
      });
    } catch (error) {
      console.error("Google authentication error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Google authentication failed."
      });
    }
  });
}

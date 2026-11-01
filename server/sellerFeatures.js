import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { createSellerAuthenticator } from "./auth.js";
import { calculatePlatformFee, normalizeOrderFees } from "./fees.js";
import { recordOrderDeliverySettlement } from "./financials.js";

const SELLER_FEATURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOGO_UPLOAD_DIR = path.join(SELLER_FEATURES_DIR, "uploads", "logos");
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function ensureLogoUploadDir() {
  fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
}

function createLogoUploader() {
  ensureLogoUploadDir();

  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      ensureLogoUploadDir();
      cb(null, LOGO_UPLOAD_DIR);
    },
    filename(_req, file, cb) {
      const ext = LOGO_MIME_EXTENSIONS[file.mimetype] || ".jpg";
      const unique = crypto.randomBytes(16).toString("hex");
      cb(null, `logo-${Date.now()}-${unique}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      if (LOGO_MIME_EXTENSIONS[file.mimetype]) {
        cb(null, true);
        return;
      }
      cb(new Error("Please upload a JPG, PNG, WEBP, or GIF image."));
    },
  }).single("logo");
}

export function initSellerFeaturesDatabase(db) {
  // Idempotent column additions for stores
  const storeCols = db.prepare("PRAGMA table_info(stores)").all().map((c) => c.name);
  const storeAdditions = [
    { name: "banner_url", def: "TEXT DEFAULT ''" },
    { name: "logo_url", def: "TEXT DEFAULT ''" },
    { name: "theme_color", def: "TEXT DEFAULT '#d4af37'" },
    { name: "announcement", def: "TEXT DEFAULT ''" },
    { name: "contact_email", def: "TEXT DEFAULT ''" },
    { name: "contact_phone", def: "TEXT DEFAULT ''" },
    { name: "bank_name", def: "TEXT DEFAULT ''" },
    { name: "bank_account_number", def: "TEXT DEFAULT ''" },
    { name: "bank_ifsc", def: "TEXT DEFAULT ''" },
    { name: "bank_account_holder", def: "TEXT DEFAULT ''" },
  ];

  for (const col of storeAdditions) {
    if (!storeCols.includes(col.name)) {
      db.exec(`ALTER TABLE stores ADD COLUMN ${col.name} ${col.def}`);
      console.log(`Migration: added column ${col.name} to stores.`);
    }
  }

  // Idempotent column additions for orders
  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  const orderAdditions = [
    { name: "tracking_number", def: "TEXT DEFAULT ''" },
    { name: "courier_name", def: "TEXT DEFAULT ''" },
    { name: "dispatch_date", def: "TEXT DEFAULT ''" },
  ];

  for (const col of orderAdditions) {
    if (!orderCols.includes(col.name)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.def}`);
      console.log(`Migration: added column ${col.name} to orders.`);
    }
  }

  // Idempotent table creation for discounts
  db.exec(`
    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      code TEXT NOT NULL COLLATE NOCASE,
      type TEXT NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage', 'fixed')),
      value REAL NOT NULL CHECK (value > 0),
      min_order_amount REAL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Idempotent table creation for store_plugins
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      plugin_key TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, plugin_key)
    )
  `);
}

export function registerSellerFeatureRoutes(app, db, jwtSecret) {
  const authenticateSeller = createSellerAuthenticator(jwtSecret);
  const uploadSellerLogo = createLogoUploader();

  function getSellerStore(userId) {
    return db.prepare(`
      SELECT *
      FROM stores
      WHERE owner_user_id = ?
      LIMIT 1
    `).get(userId);
  }

  // GET /api/seller/store - Get full store details for appearance and settings
  app.get("/api/seller/store", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found.",
        });
      }

      return res.json({
        status: "success",
        store,
      });
    } catch (error) {
      console.error("Get seller store error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch store details.",
      });
    }
  });

  // POST /api/seller/store/logo - Upload a device logo image (does not replace PUT /api/seller/store)
  app.post("/api/seller/store/logo", authenticateSeller, (req, res) => {
    const store = getSellerStore(req.seller.id);
    if (!store) {
      return res.status(404).json({
        status: "error",
        message: "Seller store not found.",
      });
    }

    uploadSellerLogo(req, res, (err) => {
      if (err) {
        const isSize = err.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({
          status: "error",
          message: isSize
            ? "Logo must be 2MB or smaller."
            : err.message || "Logo upload failed.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          status: "error",
          message: "Please select an image file to upload.",
        });
      }

      const storedName = path.basename(req.file.filename);
      const logoUrl = `/uploads/logos/${storedName}`;

      return res.json({
        status: "success",
        message: "Logo uploaded successfully.",
        logo_url: logoUrl,
      });
    });
  });

  // PUT /api/seller/store - Update store details, branding, appearance & payout settings
  app.put("/api/seller/store", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found.",
        });
      }

      const {
        name,
        description,
        announcement,
        theme_color,
        logo_url,
        banner_url,
        contact_email,
        contact_phone,
        bank_account_holder,
        bank_name,
        bank_account_number,
        bank_ifsc,
      } = req.body ?? {};

      const updates = [];
      const values = [];

      if (typeof name === "string" && name.trim()) {
        if (name.trim().length > 100) {
          return res.status(400).json({ status: "error", message: "Store name too long (max 100 characters)." });
        }
        updates.push("name = ?");
        values.push(name.trim());
      }

      if (typeof description === "string") {
        if (description.length > 5000) {
          return res.status(400).json({ status: "error", message: "Description too long (max 5000 characters)." });
        }
        updates.push("description = ?");
        values.push(description.trim());
      }

      if (typeof announcement === "string") {
        updates.push("announcement = ?");
        values.push(announcement.trim().slice(0, 500));
      }

      const effectiveThemeColor = theme_color ?? req.body?.themeColor;
      if (typeof effectiveThemeColor === "string") {
        let cleanColor = effectiveThemeColor.trim();
        if (/^#[0-9a-fA-F]{3}$/.test(cleanColor)) {
          cleanColor = `#${cleanColor[1]}${cleanColor[1]}${cleanColor[2]}${cleanColor[2]}${cleanColor[3]}${cleanColor[3]}`;
        }
        if (/^#[0-9a-fA-F]{6}$/.test(cleanColor)) {
          updates.push("theme_color = ?");
          values.push(cleanColor);
        }
      }

      const effectiveLogoUrl = logo_url ?? req.body?.logoUrl;
      if (typeof effectiveLogoUrl === "string") {
        updates.push("logo_url = ?");
        values.push(effectiveLogoUrl.trim().slice(0, 2048));
      }

      const effectiveBannerUrl = banner_url ?? req.body?.bannerUrl;
      if (typeof effectiveBannerUrl === "string") {
        updates.push("banner_url = ?");
        values.push(effectiveBannerUrl.trim().slice(0, 2048));
      }

      if (typeof contact_email === "string") {
        updates.push("contact_email = ?");
        values.push(contact_email.trim().slice(0, 254));
      }

      if (typeof contact_phone === "string") {
        updates.push("contact_phone = ?");
        values.push(contact_phone.trim().slice(0, 50));
      }

      if (typeof bank_account_holder === "string") {
        updates.push("bank_account_holder = ?");
        values.push(bank_account_holder.trim().slice(0, 100));
      }

      if (typeof bank_name === "string") {
        updates.push("bank_name = ?");
        values.push(bank_name.trim().slice(0, 100));
      }

      if (typeof bank_account_number === "string") {
        updates.push("bank_account_number = ?");
        values.push(bank_account_number.trim().slice(0, 50));
      }

      if (typeof bank_ifsc === "string") {
        updates.push("bank_ifsc = ?");
        values.push(bank_ifsc.trim().toUpperCase().slice(0, 20));
      }

      if (updates.length > 0) {
        values.push(store.id);
        db.prepare(`UPDATE stores SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      }

      const updatedStore = db.prepare("SELECT * FROM stores WHERE id = ?").get(store.id);

      return res.json({
        status: "success",
        message: "Store updated successfully.",
        store: updatedStore,
      });
    } catch (error) {
      console.error("Update seller store error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to update store.",
      });
    }
  });

  // PUT /api/seller/orders/:id/delivery - Update tracking and delivery details
  app.put("/api/seller/orders/:id/delivery", authenticateSeller, (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid order ID." });
      }

      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const existing = db.prepare("SELECT id FROM orders WHERE id = ? AND store_id = ?").get(orderId, store.id);
      if (!existing) {
        return res.status(404).json({ status: "error", message: "Order not found in your store." });
      }

      const { tracking_number, courier_name, status, dispatch_date } = req.body ?? {};
      const updates = [];
      const values = [];

      if (typeof tracking_number === "string") {
        updates.push("tracking_number = ?");
        values.push(tracking_number.trim().slice(0, 100));
      }

      if (typeof courier_name === "string") {
        updates.push("courier_name = ?");
        values.push(courier_name.trim().slice(0, 100));
      }

      if (typeof dispatch_date === "string") {
        updates.push("dispatch_date = ?");
        values.push(dispatch_date.trim().slice(0, 50));
      }

      if (typeof status === "string") {
        const allowed = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
        if (allowed.includes(status)) {
          updates.push("status = ?");
          values.push(status);
          if (status === "Delivered") {
            const ord = db.prepare("SELECT total, platform_fee FROM orders WHERE id = ?").get(orderId);
            if (ord && (ord.platform_fee === null || ord.platform_fee === undefined)) {
              const feeDetails = calculatePlatformFee(ord.total);
              updates.push("platform_fee = ?", "seller_payout = ?", "fee_rate = ?");
              values.push(feeDetails.platform_fee, feeDetails.seller_payout, feeDetails.fee_rate);
            }
          }
        }
      }

      if (updates.length > 0) {
        values.push(orderId, store.id);
        db.prepare(`UPDATE orders SET ${updates.join(", ")} WHERE id = ? AND store_id = ?`).run(...values);
      }

      if (status === "Delivered") {
        recordOrderDeliverySettlement(db, orderId);
      }

      const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);

      return res.json({
        status: "success",
        message: "Delivery details updated successfully.",
        order: {
          ...normalizeOrderFees(updated),
          items: JSON.parse(updated.items),
        },
      });
    } catch (error) {
      console.error("Update delivery error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update delivery details." });
    }
  });

  // GET /api/seller/discounts - List discounts for seller's store
  app.get("/api/seller/discounts", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const discounts = db.prepare(`
        SELECT * FROM discounts WHERE store_id = ? ORDER BY id DESC
      `).all(store.id);

      return res.json({
        status: "success",
        discounts,
      });
    } catch (error) {
      console.error("Get discounts error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch discounts." });
    }
  });

  // POST /api/seller/discounts - Create discount coupon
  app.post("/api/seller/discounts", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const { code, type = "percentage", value, min_order_amount = 0, is_active = 1 } = req.body ?? {};

      if (typeof code !== "string" || !code.trim() || code.trim().length > 30) {
        return res.status(400).json({ status: "error", message: "A valid coupon code (1-30 chars) is required." });
      }

      const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      if (!cleanCode) {
        return res.status(400).json({ status: "error", message: "Invalid coupon code characters." });
      }

      if (!["percentage", "fixed"].includes(type)) {
        return res.status(400).json({ status: "error", message: "Discount type must be 'percentage' or 'fixed'." });
      }

      const numVal = Number(value);
      if (!Number.isFinite(numVal) || numVal <= 0) {
        return res.status(400).json({ status: "error", message: "Discount value must be greater than 0." });
      }

      if (type === "percentage" && numVal > 100) {
        return res.status(400).json({ status: "error", message: "Percentage discount cannot exceed 100%." });
      }

      const minOrder = Number(min_order_amount) || 0;

      // Check duplicate code for this store
      const existing = db.prepare("SELECT id FROM discounts WHERE store_id = ? AND code = ?").get(store.id, cleanCode);
      if (existing) {
        return res.status(400).json({ status: "error", message: `Coupon "${cleanCode}" already exists for your store.` });
      }

      const result = db.prepare(`
        INSERT INTO discounts (store_id, code, type, value, min_order_amount, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(store.id, cleanCode, type, numVal, minOrder, is_active ? 1 : 0);

      const created = db.prepare("SELECT * FROM discounts WHERE id = ?").get(result.lastInsertRowid);

      return res.status(201).json({
        status: "success",
        message: "Discount coupon created successfully.",
        discount: created,
      });
    } catch (error) {
      console.error("Create discount error:", error);
      return res.status(500).json({ status: "error", message: "Failed to create discount." });
    }
  });

  // PUT /api/seller/discounts/:id - Toggle or update discount
  app.put("/api/seller/discounts/:id", authenticateSeller, (req, res) => {
    try {
      const discountId = Number(req.params.id);
      if (!Number.isSafeInteger(discountId) || discountId <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid discount ID." });
      }

      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const existing = db.prepare("SELECT id FROM discounts WHERE id = ? AND store_id = ?").get(discountId, store.id);
      if (!existing) {
        return res.status(404).json({ status: "error", message: "Discount not found in your store." });
      }

      const { is_active } = req.body ?? {};
      if (is_active !== undefined) {
        db.prepare("UPDATE discounts SET is_active = ? WHERE id = ? AND store_id = ?")
          .run(is_active ? 1 : 0, discountId, store.id);
      }

      const updated = db.prepare("SELECT * FROM discounts WHERE id = ?").get(discountId);
      return res.json({
        status: "success",
        message: "Discount updated successfully.",
        discount: updated,
      });
    } catch (error) {
      console.error("Update discount error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update discount." });
    }
  });

  // DELETE /api/seller/discounts/:id - Delete discount
  app.delete("/api/seller/discounts/:id", authenticateSeller, (req, res) => {
    try {
      const discountId = Number(req.params.id);
      if (!Number.isSafeInteger(discountId) || discountId <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid discount ID." });
      }

      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const result = db.prepare("DELETE FROM discounts WHERE id = ? AND store_id = ?").run(discountId, store.id);
      if (result.changes === 0) {
        return res.status(404).json({ status: "error", message: "Discount not found." });
      }

      return res.json({
        status: "success",
        message: "Discount deleted successfully.",
      });
    } catch (error) {
      console.error("Delete discount error:", error);
      return res.status(500).json({ status: "error", message: "Failed to delete discount." });
    }
  });

  // PUBLIC: POST /api/stores/:slug/validate-discount - For checkout validation
  app.post("/api/stores/:slug/validate-discount", (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim().toLowerCase();
      const { code, subtotal } = req.body ?? {};

      if (!code || typeof code !== "string") {
        return res.status(400).json({ status: "error", message: "Coupon code is required." });
      }

      const store = db.prepare("SELECT id FROM stores WHERE slug = ? COLLATE NOCASE").get(slug);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Store not found." });
      }

      const cleanCode = code.trim().toUpperCase();
      const discount = db.prepare(`
        SELECT * FROM discounts WHERE store_id = ? AND code = ? AND is_active = 1
      `).get(store.id, cleanCode);

      if (!discount) {
        return res.status(404).json({ status: "error", message: "Invalid or inactive coupon code." });
      }

      const orderSubtotal = Number(subtotal) || 0;
      if (discount.min_order_amount > 0 && orderSubtotal < discount.min_order_amount) {
        return res.status(400).json({
          status: "error",
          message: `Minimum order amount of ₹${discount.min_order_amount} required to use this coupon.`,
        });
      }

      let discountAmount = 0;
      if (discount.type === "percentage") {
        discountAmount = Math.round((orderSubtotal * discount.value) / 100);
      } else {
        discountAmount = Math.min(discount.value, orderSubtotal);
      }

      return res.json({
        status: "success",
        valid: true,
        code: discount.code,
        type: discount.type,
        value: discount.value,
        discountAmount,
      });
    } catch (error) {
      console.error("Validate discount error:", error);
      return res.status(500).json({ status: "error", message: "Failed to validate coupon." });
    }
  });

  // GET /api/seller/plugins - Get configuration status for all plugins
  app.get("/api/seller/plugins", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const rows = db.prepare("SELECT * FROM store_plugins WHERE store_id = ?").all(store.id);
      const pluginMap = {};
      for (const row of rows) {
        let parsedConfig = {};
        try {
          parsedConfig = JSON.parse(row.config || "{}");
        } catch {}
        pluginMap[row.plugin_key] = {
          is_enabled: Boolean(row.is_enabled),
          config: parsedConfig,
          updated_at: row.updated_at,
        };
      }

      return res.json({
        status: "success",
        plugins: pluginMap,
      });
    } catch (error) {
      console.error("Get plugins error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch plugins." });
    }
  });

  // PUT /api/seller/plugins/:key - Save plugin configuration
  app.put("/api/seller/plugins/:key", authenticateSeller, (req, res) => {
    try {
      const key = String(req.params.key || "").trim().toLowerCase();
      const allowedKeys = ["whatsapp", "google_analytics", "shiprocket", "razorpay"];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ status: "error", message: "Invalid plugin key." });
      }

      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const { is_enabled = 1, config = {} } = req.body ?? {};

      db.prepare(`
        INSERT INTO store_plugins (store_id, plugin_key, config, is_enabled, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(store_id, plugin_key) DO UPDATE SET
          config = excluded.config,
          is_enabled = excluded.is_enabled,
          updated_at = CURRENT_TIMESTAMP
      `).run(store.id, key, JSON.stringify(config), is_enabled ? 1 : 0);

      return res.json({
        status: "success",
        message: `Plugin ${key} configuration saved.`,
      });
    } catch (error) {
      console.error("Save plugin error:", error);
      return res.status(500).json({ status: "error", message: "Failed to save plugin configuration." });
    }
  });

  // PUT /api/seller/password - Secure password change for authenticated seller
  app.put("/api/seller/password", authenticateSeller, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};

      if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
        return res.status(400).json({ status: "error", message: "Current and new passwords are required." });
      }

      if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
        return res.status(400).json({
          status: "error",
          message: "New password must be at least 8 characters and at most 72 UTF-8 bytes.",
        });
      }

      const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.seller.id);
      if (!user) {
        return res.status(404).json({ status: "error", message: "Seller account not found." });
      }

      const matches = await bcrypt.compare(currentPassword, user.password_hash);
      if (!matches) {
        return res.status(400).json({ status: "error", message: "Current password does not match." });
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);

      return res.json({
        status: "success",
        message: "Password updated successfully.",
      });
    } catch (error) {
      console.error("Update seller password error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update password." });
    }
  });
}

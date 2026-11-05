import crypto from "node:crypto";
import Razorpay from "razorpay";
import { calculatePlatformFee, normalizeOrderFees } from "./fees.js";

/**
 * Curated catalog prices for standard VELORA marketplace orders (where store_id is null).
 * Ensures server-side price verification and eliminates trusting client-sent prices.
 */
export const CURATED_MARKETPLACE_CATALOG = {
  1: { id: 1, name: "Aura Wireless Headphones", price: 1999 },
  2: { id: 2, name: "Minimal Smart Watch", price: 2499 },
  3: { id: 3, name: "Premium Everyday Backpack", price: 1299 }
};

/**
 * Safe idempotent database migration for Phase 5 Payment Gateway.
 * Adds required columns to 'orders' and creates 'payments' table if missing.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPaymentDatabase(db) {
  // 1. Safe migration: idempotent column additions on 'orders'
  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);

  const orderAdditions = [
    { name: "payment_status", def: "TEXT NOT NULL DEFAULT 'Pending'" },
    { name: "razorpay_order_id", def: "TEXT DEFAULT NULL" },
    { name: "razorpay_payment_id", def: "TEXT DEFAULT NULL" },
    { name: "payment_method", def: "TEXT DEFAULT 'razorpay'" }
  ];

  for (const col of orderAdditions) {
    if (!orderColumns.includes(col.name)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.def}`);
      console.log(`Payment Migration: Added column '${col.name}' to orders.`);
    }
  }

  // 2. Safe migration: create 'payments' table if missing
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      razorpay_order_id TEXT NOT NULL UNIQUE,
      razorpay_payment_id TEXT DEFAULT NULL,
      razorpay_signature TEXT DEFAULT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'authorized', 'captured', 'paid', 'failed', 'cancelled')),
      verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'failed', 'cancelled')),
      error_code TEXT DEFAULT NULL,
      error_description TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order ON payments(razorpay_order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment ON payments(razorpay_payment_id);
  `);

  console.log("VELORA Payment Gateway schema initialized successfully.");
}

/**
 * Reads Razorpay configuration from server environment.
 */
export function getRazorpayConfig() {
  const key_id = (process.env.RAZORPAY_KEY_ID || "").trim();
  const key_secret = (process.env.RAZORPAY_KEY_SECRET || "").trim();

  const isConfigured = Boolean(key_id && key_secret);
  const isTestMode = key_id.startsWith("rzp_test_");
  const isSimulation =
    !isConfigured ||
    key_id.includes("sandbox") ||
    key_id.includes("placeholder") ||
    key_id.includes("dummy") ||
    process.env.RAZORPAY_SIMULATION === "true";

  return {
    key_id,
    key_secret,
    isConfigured,
    isTestMode,
    isSimulation
  };
}

/**
 * Instantiates the Razorpay SDK client if credentials are real.
 */
export function getRazorpayClient() {
  const config = getRazorpayConfig();
  if (!config.isConfigured) return null;

  try {
    return new Razorpay({
      key_id: config.key_id,
      key_secret: config.key_secret
    });
  } catch (error) {
    console.error("Razorpay client initialization error:", error.message);
    return null;
  }
}

/**
 * Calculates order totals strictly server-side from product inventory / catalog.
 * Does NOT trust client-submitted prices.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{ id: number|string, quantity: number|string }>} items
 * @param {number|string|null} storeId
 * @param {string|null} discountCode
 */
export function calculateOrderTotalServerSide(db, items, storeId = null, discountCode = null) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cart is empty or items array is missing.");
  }

  // 1. Seller Store Order
  if (storeId !== null && storeId !== undefined && storeId !== "") {
    const parsedStoreId = Number(storeId);
    if (!Number.isSafeInteger(parsedStoreId) || parsedStoreId <= 0) {
      const err = new Error("Invalid store identifier.");
      err.code = "INVALID_STORE";
      throw err;
    }

    const store = db.prepare("SELECT id, name FROM stores WHERE id = ?").get(parsedStoreId);
    if (!store) {
      const err = new Error("Seller store not found.");
      err.code = "STORE_NOT_FOUND";
      throw err;
    }

    let subtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      const itemId = Number(item.id);
      const qty = Number(item.quantity);

      if (!Number.isSafeInteger(itemId) || itemId <= 0) {
        throw new Error(`Invalid product ID: ${item.id}`);
      }
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        throw new Error(`Invalid quantity for product ID ${itemId}.`);
      }

      const dbProduct = db
        .prepare(
          `SELECT id, store_id, name, price, stock, is_active FROM products WHERE id = ?`
        )
        .get(itemId);

      if (!dbProduct) {
        throw new Error(`Product ${itemId} not found in store catalogue.`);
      }
      if (dbProduct.store_id !== store.id) {
        throw new Error(`Product "${dbProduct.name}" does not belong to store "${store.name}".`);
      }
      if (dbProduct.is_active !== 1) {
        throw new Error(`Product "${dbProduct.name}" is currently unavailable.`);
      }
      if (dbProduct.stock < qty) {
        throw new Error(`Insufficient stock for "${dbProduct.name}". Only ${dbProduct.stock} units remaining.`);
      }

      subtotal += dbProduct.price * qty;
      verifiedItems.push({
        id: dbProduct.id,
        name: dbProduct.name,
        price: dbProduct.price,
        quantity: qty,
        store_id: store.id
      });
    }

    // Apply coupon if valid
    let discountAmount = 0;
    let appliedDiscount = null;
    if (discountCode && typeof discountCode === "string" && discountCode.trim()) {
      const cleanCode = discountCode.trim().toUpperCase();
      const disc = db
        .prepare(
          "SELECT * FROM discounts WHERE store_id = ? AND code = ? AND is_active = 1"
        )
        .get(store.id, cleanCode);

      if (disc) {
        if (disc.min_order_amount <= 0 || subtotal >= disc.min_order_amount) {
          if (disc.type === "percentage") {
            discountAmount = Math.round((subtotal * disc.value) / 100);
          } else {
            discountAmount = Math.min(disc.value, subtotal);
          }
          appliedDiscount = {
            code: disc.code,
            type: disc.type,
            value: disc.value,
            amount: discountAmount
          };
        }
      }
    }

    const shipping = subtotal === 0 || subtotal >= 1999 ? 0 : 99;
    const verifiedTotal = Math.max(0, subtotal - discountAmount + shipping);

    return {
      storeId: store.id,
      storeName: store.name,
      subtotal,
      discountAmount,
      appliedDiscount,
      shipping,
      verifiedTotal,
      items: verifiedItems
    };
  }

  // 2. Curated & Multi-Vendor Marketplace Order (storeId is null)
  let subtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    const itemId = Number(item.id);
    const qty = Number(item.quantity);

    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      throw new Error(`Invalid item ID: ${item.id}`);
    }
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new Error(`Invalid quantity for item ${itemId}.`);
    }

    const curated = CURATED_MARKETPLACE_CATALOG[itemId];
    if (curated) {
      subtotal += curated.price * qty;
      verifiedItems.push({
        id: curated.id,
        name: curated.name,
        price: curated.price,
        quantity: qty,
        store_id: null
      });
      continue;
    }

    const dbProduct = db
      .prepare(
        "SELECT id, store_id, name, price, stock, is_active FROM products WHERE id = ?"
      )
      .get(itemId);

    if (dbProduct) {
      if (dbProduct.is_active !== 1) {
        throw new Error(`Product "${dbProduct.name}" is currently unavailable.`);
      }
      if (dbProduct.stock < qty) {
        throw new Error(`Insufficient stock for "${dbProduct.name}". Only ${dbProduct.stock} units remaining.`);
      }

      subtotal += dbProduct.price * qty;
      verifiedItems.push({
        id: dbProduct.id,
        name: dbProduct.name,
        price: dbProduct.price,
        quantity: qty,
        store_id: dbProduct.store_id
      });
    } else {
      throw new Error(`Marketplace product #${itemId} could not be verified.`);
    }
  }

  const shipping = subtotal === 0 || subtotal >= 1999 ? 0 : 99;
  const verifiedTotal = Math.max(0, subtotal + shipping);

  return {
    storeId: null,
    storeName: "VELORA Marketplace",
    subtotal,
    discountAmount: 0,
    appliedDiscount: null,
    shipping,
    verifiedTotal,
    items: verifiedItems
  };
}

/**
 * Timing-safe Razorpay signature verification.
 * Verifies that HMAC SHA256(`${razorpay_order_id}|${razorpay_payment_id}`, secret) matches signature.
 *
 * @param {object} params
 * @param {string} params.razorpay_order_id
 * @param {string} params.razorpay_payment_id
 * @param {string} params.razorpay_signature
 * @param {string} params.secret
 * @returns {boolean}
 */
export function verifyRazorpaySignature({
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
  secret
}) {
  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature ||
    !secret
  ) {
    return false;
  }

  try {
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (computedSignature.length !== razorpay_signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, "utf8"),
      Buffer.from(razorpay_signature, "utf8")
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Registers all Payment Gateway API endpoints on the Express app.
 *
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 */
export function registerPaymentRoutes(app, db) {
  initPaymentDatabase(db);

  // 1. GET /api/payments/config — Return safe public configuration for Razorpay Checkout
  app.get("/api/payments/config", (_req, res) => {
    try {
      const config = getRazorpayConfig();
      return res.json({
        status: "success",
        key_id: config.key_id,
        currency: "INR",
        is_configured: config.isConfigured,
        is_test_mode: config.isTestMode,
        is_simulation: config.isSimulation
      });
    } catch (error) {
      console.error("Payment config error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "Failed to retrieve payment configuration."
      });
    }
  });

  // 2. POST /api/payments/create-order — Create Razorpay payment order with server-calculated amount
  app.post("/api/payments/create-order", async (req, res) => {
    try {
      const {
        customer_name,
        email,
        phone = "",
        address = "",
        city = "",
        pincode = "",
        items,
        store_id = null,
        discount_code = null
      } = req.body ?? {};

      // Basic parameter validations
      if (
        typeof customer_name !== "string" ||
        !customer_name.trim() ||
        typeof email !== "string" ||
        !email.trim() ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_REQUEST",
          message: "Valid customer_name, email, and items are required."
        });
      }

      // Calculate total strictly server-side
      let calculation;
      try {
        calculation = calculateOrderTotalServerSide(db, items, store_id, discount_code);
      } catch (calcError) {
        return res.status(400).json({
          status: "error",
          code: "CALCULATION_ERROR",
          message: calcError.message
        });
      }

      const { verifiedTotal, items: verifiedItems, storeId } = calculation;
      if (verifiedTotal <= 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_AMOUNT",
          message: "Calculated order amount must be greater than zero."
        });
      }

      // Convert INR rupees to paise for Razorpay
      const amountInPaise = Math.round(verifiedTotal * 100);
      const feeDetails = calculatePlatformFee(verifiedTotal);
      const config = getRazorpayConfig();

      // Create VELORA order and reserve stock in SQLite transaction
      let veloraOrderId;
      try {
        const createOrderTx = db.transaction(() => {
          // Reserve stock for products originating from store catalogs
          for (const vItem of verifiedItems) {
            if (vItem.store_id || storeId) {
              const result = db
                .prepare(
                  `UPDATE products
                   SET stock = stock - ?
                   WHERE id = ? AND stock >= ?`
                )
                .run(vItem.quantity, vItem.id, vItem.quantity);

              if (result.changes === 0) {
                throw new Error(`Stock for "${vItem.name}" changed. Please refresh and retry.`);
              }
            }
          }

          const orderInsert = db
            .prepare(
              `INSERT INTO orders (
                customer_name,
                email,
                total,
                items,
                status,
                payment_status,
                store_id,
                platform_fee,
                seller_payout,
                fee_rate,
                payment_method
              )
              VALUES (?, ?, ?, ?, 'Pending', 'Pending', ?, ?, ?, ?, 'razorpay')`
            )
            .run(
              customer_name.trim(),
              email.trim(),
              verifiedTotal,
              JSON.stringify(verifiedItems),
              storeId || null,
              feeDetails.platform_fee,
              feeDetails.seller_payout,
              feeDetails.fee_rate
            );

          return orderInsert.lastInsertRowid;
        });

        veloraOrderId = createOrderTx();
      } catch (txError) {
        console.error("Database order insertion error:", txError);
        return res.status(400).json({
          status: "error",
          code: "INVENTORY_ERROR",
          message: txError.message || "Failed to reserve order items."
        });
      }

      // Create Razorpay payment order
      let razorpayOrderId;
      const client = getRazorpayClient();

      if (client && !config.isSimulation) {
        try {
          const rzpOrder = await client.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt: `velora_rcpt_${veloraOrderId}`,
            notes: {
              velora_order_id: String(veloraOrderId),
              store_id: storeId ? String(storeId) : "marketplace",
              customer_name: customer_name.trim(),
              customer_email: email.trim()
            }
          });

          if (!rzpOrder || !rzpOrder.id) {
            throw new Error("Razorpay returned invalid order response.");
          }

          razorpayOrderId = rzpOrder.id;
        } catch (rzpErr) {
          console.error("Razorpay API error:", rzpErr);

          // Restore stock and mark order cancelled on gateway failure
          for (const vItem of verifiedItems) {
            if (vItem.store_id || storeId) {
              db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(
                vItem.quantity,
                vItem.id
              );
            }
          }
          db.prepare("UPDATE orders SET status = 'Cancelled', payment_status = 'Failed' WHERE id = ?").run(
            veloraOrderId
          );

          return res.status(502).json({
            status: "error",
            code: "GATEWAY_UNAVAILABLE",
            message:
              "Payment gateway is temporarily unavailable. Please try again shortly or contact support."
          });
        }
      } else {
        // Test / Sandbox Simulation Mode:
        // Generates compliant Razorpay test order ID (e.g. order_test_...)
        razorpayOrderId = `order_test_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        console.log(
          `[VELORA Payment Sandbox] Created simulated Razorpay Order: ${razorpayOrderId} for VELORA Order #${veloraOrderId} (₹${verifiedTotal})`
        );
      }

      // Record transaction in 'payments' table & update order with razorpay_order_id
      db.prepare(
        `INSERT INTO payments (
          order_id,
          razorpay_order_id,
          amount,
          currency,
          status,
          verification_status
        )
        VALUES (?, ?, ?, 'INR', 'created', 'unverified')`
      ).run(veloraOrderId, razorpayOrderId, verifiedTotal);

      db.prepare("UPDATE orders SET razorpay_order_id = ? WHERE id = ?").run(
        razorpayOrderId,
        veloraOrderId
      );

      return res.status(201).json({
        status: "success",
        orderId: veloraOrderId,
        razorpay_order_id: razorpayOrderId,
        amount: amountInPaise,
        currency: "INR",
        key_id: config.key_id,
        is_simulation: config.isSimulation,
        customer: {
          name: customer_name.trim(),
          email: email.trim(),
          contact: phone.trim()
        }
      });
    } catch (error) {
      console.error("Create payment order error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "An internal server error occurred while creating the payment order."
      });
    }
  });

  // 3. POST /api/payments/verify — Secure server-side signature verification & order confirmation
  app.post("/api/payments/verify", (req, res) => {
    try {
      const {
        velora_order_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body ?? {};

      // 1. Check required parameters
      if (
        !velora_order_id ||
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature ||
        typeof razorpay_order_id !== "string" ||
        typeof razorpay_payment_id !== "string" ||
        typeof razorpay_signature !== "string"
      ) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_PAYMENT_RESPONSE",
          message:
            "Missing required payment verification parameters: velora_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature."
        });
      }

      const orderId = Number(velora_order_id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_PAYMENT_RESPONSE",
          message: "Invalid VELORA order ID."
        });
      }

      // 2. Fetch VELORA order
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) {
        return res.status(404).json({
          status: "error",
          code: "ORDER_NOT_FOUND",
          message: `Order #${orderId} does not exist.`
        });
      }

      // 3. Fetch linked payment record
      const payment = db
        .prepare("SELECT * FROM payments WHERE razorpay_order_id = ?")
        .get(razorpay_order_id.trim());

      if (!payment || payment.order_id !== order.id) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_PAYMENT_RESPONSE",
          message: "Payment transaction does not match this order."
        });
      }

      // 4. Check for duplicate payment confirmation (Idempotency)
      if (
        payment.verification_status === "verified" &&
        payment.razorpay_payment_id === razorpay_payment_id.trim()
      ) {
        return res.json({
          status: "success",
          message: "Payment has already been securely verified.",
          orderId: order.id,
          paymentId: payment.razorpay_payment_id,
          already_verified: true,
          order: {
            ...normalizeOrderFees(order),
            items: JSON.parse(order.items)
          }
        });
      }

      if (order.payment_status === "Paid" && payment.razorpay_payment_id !== razorpay_payment_id.trim()) {
        return res.status(409).json({
          status: "error",
          code: "DUPLICATE_PAYMENT",
          message: "This order has already been paid via another transaction."
        });
      }

      // 5. Amount mismatch validation
      if (Math.abs(payment.amount - order.total) > 0.01) {
        return res.status(400).json({
          status: "error",
          code: "AMOUNT_MISMATCH",
          message: `Payment amount (${payment.amount}) does not match order total (${order.total}).`
        });
      }

      // 6. Cryptographic signature verification using server secret
      const config = getRazorpayConfig();
      const isValid = verifyRazorpaySignature({
        razorpay_order_id: razorpay_order_id.trim(),
        razorpay_payment_id: razorpay_payment_id.trim(),
        razorpay_signature: razorpay_signature.trim(),
        secret: config.key_secret
      });

      if (!isValid) {
        // Mark payment verification failed
        db.prepare(
          `UPDATE payments
           SET status = 'failed',
               verification_status = 'failed',
               error_code = 'SIGNATURE_VERIFICATION_FAILED',
               error_description = 'HMAC SHA256 signature did not match secret',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(payment.id);

        return res.status(400).json({
          status: "error",
          code: "SIGNATURE_VERIFICATION_FAILED",
          message:
            "Razorpay signature verification failed. The payment could not be authenticated securely."
        });
      }

      // 7. Secure verification succeeded: mark order as Paid
      const confirmPaymentTx = db.transaction(() => {
        db.prepare(
          `UPDATE payments
           SET status = 'paid',
               verification_status = 'verified',
               razorpay_payment_id = ?,
               razorpay_signature = ?,
               error_code = NULL,
               error_description = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(razorpay_payment_id.trim(), razorpay_signature.trim(), payment.id);

        db.prepare(
          `UPDATE orders
           SET payment_status = 'Paid',
               razorpay_order_id = ?,
               razorpay_payment_id = ?
           WHERE id = ?`
        ).run(razorpay_order_id.trim(), razorpay_payment_id.trim(), order.id);
      });

      confirmPaymentTx();

      const confirmedOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);

      return res.json({
        status: "success",
        message: "Payment successfully verified and order confirmed.",
        orderId: confirmedOrder.id,
        paymentId: razorpay_payment_id.trim(),
        order: {
          ...normalizeOrderFees(confirmedOrder),
          items: JSON.parse(confirmedOrder.items)
        }
      });
    } catch (error) {
      console.error("Payment verification error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "Internal server error during payment verification."
      });
    }
  });

  // 4. POST /api/payments/cancel — Handle customer cancellation
  app.post("/api/payments/cancel", (req, res) => {
    try {
      const { velora_order_id, razorpay_order_id, reason = "Customer cancelled checkout" } = req.body ?? {};

      if (!velora_order_id) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_REQUEST",
          message: "velora_order_id is required."
        });
      }

      const orderId = Number(velora_order_id);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) {
        return res.status(404).json({
          status: "error",
          code: "ORDER_NOT_FOUND",
          message: "Order not found."
        });
      }

      // Never cancel an already verified paid order
      if (order.payment_status === "Paid") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_PAID",
          message: "Cannot cancel a paid order."
        });
      }

      const payment = razorpay_order_id
        ? db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(razorpay_order_id)
        : db.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(orderId);

      const cancelTx = db.transaction(() => {
        if (payment && payment.status !== "paid") {
          db.prepare(
            `UPDATE payments
             SET status = 'cancelled',
                 verification_status = 'cancelled',
                 error_code = 'USER_CANCELLED',
                 error_description = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(reason, payment.id);
        }

        db.prepare(
          `UPDATE orders
           SET payment_status = 'Cancelled'
           WHERE id = ?`
        ).run(orderId);

        // Restore reserved stock
        try {
          const items = JSON.parse(order.items);
          for (const it of items) {
            if (it.store_id || order.store_id) {
              db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(
                it.quantity,
                it.id
              );
            }
          }
        } catch (e) {
          console.error("Stock restore error:", e);
        }
      });

      cancelTx();

      return res.json({
        status: "success",
        code: "CANCELLED_PAYMENT",
        message: "Payment marked as cancelled. Stock released back to store."
      });
    } catch (error) {
      console.error("Payment cancel error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "Failed to record payment cancellation."
      });
    }
  });

  // 5. POST /api/payments/fail — Handle gateway failure
  app.post("/api/payments/fail", (req, res) => {
    try {
      const {
        velora_order_id,
        razorpay_order_id,
        error_code = "PAYMENT_FAILED",
        error_description = "Payment failed at gateway"
      } = req.body ?? {};

      if (!velora_order_id) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_REQUEST",
          message: "velora_order_id is required."
        });
      }

      const orderId = Number(velora_order_id);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) {
        return res.status(404).json({
          status: "error",
          code: "ORDER_NOT_FOUND",
          message: "Order not found."
        });
      }

      if (order.payment_status === "Paid") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_PAID",
          message: "Cannot mark a paid order as failed."
        });
      }

      const payment = razorpay_order_id
        ? db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(razorpay_order_id)
        : db.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(orderId);

      const failTx = db.transaction(() => {
        if (payment && payment.status !== "paid") {
          db.prepare(
            `UPDATE payments
             SET status = 'failed',
                 verification_status = 'failed',
                 error_code = ?,
                 error_description = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(error_code, error_description, payment.id);
        }

        db.prepare(
          `UPDATE orders
           SET payment_status = 'Failed'
           WHERE id = ?`
        ).run(orderId);

        // Restore reserved stock
        try {
          const items = JSON.parse(order.items);
          for (const it of items) {
            if (it.store_id || order.store_id) {
              db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(
                it.quantity,
                it.id
              );
            }
          }
        } catch (e) {
          console.error("Stock restore error:", e);
        }
      });

      failTx();

      return res.json({
        status: "success",
        code: "PAYMENT_FAILED",
        message: "Payment failure recorded. Stock restored."
      });
    } catch (error) {
      console.error("Payment fail error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "Failed to record payment failure."
      });
    }
  });

  // 6. GET /api/payments/order/:orderId — Fetch payment status for an order
  app.get("/api/payments/order/:orderId", (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_REQUEST",
          message: "Invalid order ID."
        });
      }

      const payments = db
        .prepare(
          `SELECT id, order_id, razorpay_order_id, razorpay_payment_id, amount, currency, status, verification_status, error_code, error_description, created_at, updated_at
           FROM payments
           WHERE order_id = ?
           ORDER BY id DESC`
        )
        .all(orderId);

      return res.json({
        status: "success",
        payments
      });
    } catch (error) {
      console.error("Get order payments error:", error);
      return res.status(500).json({
        status: "error",
        code: "BACKEND_FAILURE",
        message: "Failed to fetch payment details."
      });
    }
  });

  // 7. POST /api/payments/sandbox-signature — Sandbox Testing Helper
  // Generates genuine HMAC SHA256 signature for automated/UI sandbox testing without exposing secret to client
  app.post("/api/payments/sandbox-signature", (req, res) => {
    try {
      const config = getRazorpayConfig();
      if (process.env.NODE_ENV === "production" || !config.isTestMode) {
        return res.status(403).json({
          status: "error",
          message: "Sandbox signature generator is disabled outside development/test mode."
        });
      }

      const { razorpay_order_id, razorpay_payment_id } = req.body ?? {};
      if (!razorpay_order_id || !razorpay_payment_id) {
        return res.status(400).json({
          status: "error",
          message: "razorpay_order_id and razorpay_payment_id are required."
        });
      }

      const signature = crypto
        .createHmac("sha256", config.key_secret)
        .update(`${razorpay_order_id.trim()}|${razorpay_payment_id.trim()}`)
        .digest("hex");

      return res.json({
        status: "success",
        signature
      });
    } catch (error) {
      console.error("Sandbox signature error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to generate sandbox test signature."
      });
    }
  });
}

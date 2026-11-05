import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerAuthRoutes } from "./auth.js";
import { registerProductRoutes } from "./products.js";
import { createAdminAuthenticator, registerAdminAuthRoutes } from "./adminAuth.js";
import { registerSellerRegistrationRoutes } from "./sellerRegistration.js";
import { initSellerFeaturesDatabase, registerSellerFeatureRoutes } from "./sellerFeatures.js";
import { PLATFORM_FEE_RATE, calculatePlatformFee, normalizeOrderFees } from "./fees.js";
import { registerPaymentRoutes } from "./payments.js";
import { initFinancialDatabase, registerFinancialRoutes, recordOrderDeliverySettlement } from "./financials.js";
import { registerCustomerAuthRoutes } from "./customerAuth.js";
import { registerMarketplaceRoutes } from "./marketplace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
dotenv.config({ path: path.join(__dirname, ".env") });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is missing or too short in server/.env");
}

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!ADMIN_SECRET || ADMIN_SECRET.length < 32) {
  throw new Error("ADMIN_SECRET is missing or too short in server/.env");
}

if (!ADMIN_PASSWORD_HASH || !ADMIN_PASSWORD_HASH.startsWith("$2")) {
  throw new Error("ADMIN_PASSWORD_HASH is missing or invalid in server/.env");
}
// App configuration
const app = express();
const PORT = 5000;

app.use(cors());
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(path.join(uploadsDir, "logos"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "products"), { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// Database connection
const db = new Database(path.join(__dirname, "velora.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Preserve existing orders and create the table only if missing.
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    total REAL NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Safe migration: add status only when missing.
const orderColumns = db.prepare("PRAGMA table_info(orders)").all();

const hasStatusColumn = orderColumns.some(
  (column) => column.name === "status"
);

if (!hasStatusColumn) {
  db.exec(`
    ALTER TABLE orders
    ADD COLUMN status TEXT NOT NULL DEFAULT 'Pending'
  `);

  console.log("Migration successful: order status column added.");
} else {
  console.log("Orders status column already exists.");
}

// Safe migration: add store_id to orders only when missing (leaves existing orders NULL).
const hasStoreIdColumn = orderColumns.some(
  (column) => column.name === "store_id"
);

if (!hasStoreIdColumn) {
  db.exec(`
    ALTER TABLE orders
    ADD COLUMN store_id INTEGER REFERENCES stores(id)
  `);

  console.log("Migration successful: store_id column added to orders.");
} else {
  console.log("Orders store_id column already exists.");
}

// Safe migration: add platform_fee, seller_payout, and fee_rate to orders when missing.
const hasPlatformFeeColumn = orderColumns.some(
  (column) => column.name === "platform_fee"
);
if (!hasPlatformFeeColumn) {
  db.exec(`
    ALTER TABLE orders
    ADD COLUMN platform_fee REAL DEFAULT NULL
  `);
  console.log("Migration successful: platform_fee column added to orders.");
} else {
  console.log("Orders platform_fee column already exists.");
}

const hasSellerPayoutColumn = orderColumns.some(
  (column) => column.name === "seller_payout"
);
if (!hasSellerPayoutColumn) {
  db.exec(`
    ALTER TABLE orders
    ADD COLUMN seller_payout REAL DEFAULT NULL
  `);
  console.log("Migration successful: seller_payout column added to orders.");
} else {
  console.log("Orders seller_payout column already exists.");
}

const hasFeeRateColumn = orderColumns.some(
  (column) => column.name === "fee_rate"
);
if (!hasFeeRateColumn) {
  db.exec(`
    ALTER TABLE orders
    ADD COLUMN fee_rate REAL DEFAULT NULL
  `);
  console.log("Migration successful: fee_rate column added to orders.");
} else {
  console.log("Orders fee_rate column already exists.");
}

// Safe migration: add category to products only when missing.
const productColumns = db.prepare("PRAGMA table_info(products)").all();
const hasCategoryColumn = productColumns.some(
  (column) => column.name === "category"
);

if (!hasCategoryColumn) {
  db.exec(`
    ALTER TABLE products
    ADD COLUMN category TEXT DEFAULT 'General'
  `);

  console.log("Migration successful: category column added to products.");
} else {
  console.log("Products category column already exists.");
}

const ALLOWED_STATUSES = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled"
];

console.log("VELORA database connected successfully.");

// Initialize seller features schema
initSellerFeaturesDatabase(db);

// Authentication routes
registerAuthRoutes(app, db, JWT_SECRET);
registerAdminAuthRoutes(app, ADMIN_SECRET, ADMIN_PASSWORD_HASH);
registerSellerRegistrationRoutes(app, db, JWT_SECRET);
registerCustomerAuthRoutes(app, db, JWT_SECRET);
const authenticateAdmin = createAdminAuthenticator(ADMIN_SECRET);

// Seller product routes and public store routes
registerProductRoutes(app, db, JWT_SECRET);
registerSellerFeatureRoutes(app, db, JWT_SECRET);
registerPaymentRoutes(app, db);
registerFinancialRoutes(app, db, JWT_SECRET, ADMIN_SECRET);
registerMarketplaceRoutes(app, db, JWT_SECRET, ADMIN_SECRET);

// Home
app.get("/", (req, res) => {
  res.json({
    store: "VELORA",
    status: "Backend is running!"
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "success",
    database: "connected",
    store: "VELORA"
  });
});

// Create order
app.post("/api/orders", (req, res) => {
  try {
    const { customer_name, email, total, items, store_id, discount_code } = req.body ?? {};

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
        message: "Valid customer_name, email, and items are required."
      });
    }

    // Single-store validation if order is submitted for a seller store
    if (store_id !== undefined && store_id !== null && store_id !== "") {
      const parsedStoreId = Number(store_id);
      if (!Number.isSafeInteger(parsedStoreId) || parsedStoreId <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid store identifier."
        });
      }

      const store = db.prepare(`SELECT id, name FROM stores WHERE id = ?`).get(parsedStoreId);
      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      let calculatedSubtotal = 0;
      const verifiedItems = [];

      for (const item of items) {
        const itemId = Number(item.id);
        const quantity = Number(item.quantity);

        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
          return res.status(400).json({
            status: "error",
            message: `Invalid product ID: ${item.id}`
          });
        }

        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
          return res.status(400).json({
            status: "error",
            message: `Invalid quantity for product ID ${itemId}.`
          });
        }

        const dbProduct = db.prepare(`
          SELECT id, store_id, name, price, stock, is_active
          FROM products
          WHERE id = ?
        `).get(itemId);

        if (!dbProduct) {
          return res.status(404).json({
            status: "error",
            message: `Product ${itemId} not found in store catalogue.`
          });
        }

        // Enforce single-store cart: every product must belong to this specific store
        if (dbProduct.store_id !== store.id) {
          return res.status(400).json({
            status: "error",
            message: `Product "${dbProduct.name}" does not belong to store "${store.name}". Mixed-store carts are not allowed.`
          });
        }

        if (dbProduct.is_active !== 1) {
          return res.status(400).json({
            status: "error",
            message: `Product "${dbProduct.name}" is currently inactive or unavailable.`
          });
        }

        if (dbProduct.stock < quantity) {
          return res.status(400).json({
            status: "error",
            message: `Insufficient stock for "${dbProduct.name}". Only ${dbProduct.stock} units remaining.`
          });
        }

        calculatedSubtotal += dbProduct.price * quantity;
        verifiedItems.push({
          id: dbProduct.id,
          name: dbProduct.name,
          price: dbProduct.price,
          quantity: quantity,
          store_id: store.id
        });
      }

      // Calculate discount if code provided
      let discountAmount = 0;
      if (discount_code && typeof discount_code === "string" && discount_code.trim()) {
        const cleanCode = discount_code.trim().toUpperCase();
        const disc = db.prepare("SELECT * FROM discounts WHERE store_id = ? AND code = ? AND is_active = 1").get(store.id, cleanCode);
        if (disc) {
          if (disc.min_order_amount <= 0 || calculatedSubtotal >= disc.min_order_amount) {
            if (disc.type === "percentage") {
              discountAmount = Math.round((calculatedSubtotal * disc.value) / 100);
            } else {
              discountAmount = Math.min(disc.value, calculatedSubtotal);
            }
          }
        }
      }

      // Calculate server-verified total (subtotal - discount + standard shipping rule)
      const calculatedShipping = calculatedSubtotal === 0 || calculatedSubtotal >= 1999 ? 0 : 99;
      const verifiedTotal = Math.max(0, calculatedSubtotal - discountAmount + calculatedShipping);
      const feeDetails = calculatePlatformFee(verifiedTotal);

      const executeOrderTransaction = db.transaction(() => {
        for (const vItem of verifiedItems) {
          db.prepare(`
            UPDATE products
            SET stock = stock - ?
            WHERE id = ? AND stock >= ?
          `).run(vItem.quantity, vItem.id, vItem.quantity);
        }

        const orderResult = db.prepare(`
          INSERT INTO orders (
            customer_name,
            email,
            total,
            items,
            status,
            store_id,
            platform_fee,
            seller_payout,
            fee_rate
          )
          VALUES (?, ?, ?, ?, 'Pending', ?, ?, ?, ?)
        `).run(
          customer_name.trim(),
          email.trim(),
          verifiedTotal,
          JSON.stringify(verifiedItems),
          store.id,
          feeDetails.platform_fee,
          feeDetails.seller_payout,
          feeDetails.fee_rate
        );

        return orderResult.lastInsertRowid;
      });

      const orderId = executeOrderTransaction();
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

      return res.status(201).json({
        status: "success",
        message: "Order placed successfully!",
        orderId,
        order: {
          ...normalizeOrderFees(order),
          items: JSON.parse(order.items)
        }
      });
    }

    // Curated & Multi-Vendor VELORA marketplace orders (store_id = NULL)
    let calculatedSubtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      const itemId = Number(item.id);
      const quantity = Number(item.quantity);

      if (!Number.isSafeInteger(itemId) || itemId <= 0) {
        return res.status(400).json({
          status: "error",
          message: `Invalid product ID: ${item.id}`
        });
      }

      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: `Invalid quantity for product ID ${itemId}.`
        });
      }

      const dbProduct = db.prepare(`
        SELECT id, store_id, name, price, stock, is_active
        FROM products
        WHERE id = ?
      `).get(itemId);

      if (dbProduct) {
        if (dbProduct.is_active !== 1) {
          return res.status(400).json({
            status: "error",
            message: `Product "${dbProduct.name}" is currently inactive or unavailable.`
          });
        }
        if (dbProduct.stock < quantity) {
          return res.status(400).json({
            status: "error",
            message: `Insufficient stock for "${dbProduct.name}". Only ${dbProduct.stock} units remaining.`
          });
        }
        calculatedSubtotal += dbProduct.price * quantity;
        verifiedItems.push({
          id: dbProduct.id,
          name: dbProduct.name,
          price: dbProduct.price,
          quantity: quantity,
          store_id: dbProduct.store_id
        });
      } else {
        // Fallback for curated catalog item
        const fallbackPrice = typeof item.price === "number" && item.price >= 0 ? item.price : 0;
        calculatedSubtotal += fallbackPrice * quantity;
        verifiedItems.push({
          id: itemId,
          name: item.name || `Product #${itemId}`,
          price: fallbackPrice,
          quantity: quantity,
          store_id: null
        });
      }
    }

    const calculatedShipping = calculatedSubtotal === 0 || calculatedSubtotal >= 1999 ? 0 : 99;
    const verifiedTotal = Math.max(0, calculatedSubtotal + calculatedShipping);
    const feeDetails = calculatePlatformFee(verifiedTotal);

    const executeMarketplaceTx = db.transaction(() => {
      // Atomic stock reservation
      for (const vItem of verifiedItems) {
        if (vItem.store_id) {
          db.prepare(`
            UPDATE products
            SET stock = stock - ?
            WHERE id = ? AND stock >= ?
          `).run(vItem.quantity, vItem.id, vItem.quantity);
        }
      }

      const result = db.prepare(`
        INSERT INTO orders (
          customer_name,
          email,
          total,
          items,
          status,
          store_id,
          platform_fee,
          seller_payout,
          fee_rate
        )
        VALUES (?, ?, ?, ?, 'Pending', NULL, ?, ?, ?)
      `).run(
        customer_name.trim(),
        email.trim(),
        verifiedTotal,
        JSON.stringify(verifiedItems),
        feeDetails.platform_fee,
        feeDetails.seller_payout,
        feeDetails.fee_rate
      );

      return result.lastInsertRowid;
    });

    const orderId = executeMarketplaceTx();
    const order = db.prepare(`
      SELECT *
      FROM orders
      WHERE id = ?
    `).get(orderId);

    return res.status(201).json({
      status: "success",
      message: "VELORA marketplace order created successfully!",
      orderId,
      order: {
        ...normalizeOrderFees(order),
        items: JSON.parse(order.items)
      }
    });
  } catch (error) {
    console.error("Create order error:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to create order."
    });
  }
});

// Get all orders (Admin)
app.get("/api/orders", authenticateAdmin, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT o.*, s.name AS store_name, s.slug AS store_slug
      FROM orders o
      LEFT JOIN stores s ON o.store_id = s.id
      ORDER BY o.id DESC
    `).all();

    const formattedOrders = orders.map((order) => ({
      ...normalizeOrderFees(order),
      items: JSON.parse(order.items)
    }));

    return res.json({
      status: "success",
      count: formattedOrders.length,
      orders: formattedOrders
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch orders."
    });
  }
});

// Update order status
app.put("/api/orders/:id/status", authenticateAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid order ID."
      });
    }

    if (
      typeof status !== "string" ||
      !ALLOWED_STATUSES.includes(status)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid order status.",
        allowedStatuses: ALLOWED_STATUSES
      });
    }

    const existingOrder = db.prepare("SELECT total, platform_fee FROM orders WHERE id = ?").get(id);
    if (!existingOrder) {
      return res.status(404).json({
        status: "error",
        message: "Order not found."
      });
    }

    if (status === "Delivered" && (existingOrder.platform_fee === null || existingOrder.platform_fee === undefined)) {
      const feeDetails = calculatePlatformFee(existingOrder.total);
      db.prepare(`
        UPDATE orders
        SET status = ?, platform_fee = ?, seller_payout = ?, fee_rate = ?
        WHERE id = ?
      `).run(status, feeDetails.platform_fee, feeDetails.seller_payout, feeDetails.fee_rate, id);
    } else {
      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `).run(status, id);
    }

    if (status === "Delivered") {
      recordOrderDeliverySettlement(db, id);
    }

    const order = db.prepare(`
      SELECT *
      FROM orders
      WHERE id = ?
    `).get(id);

    return res.json({
      status: "success",
      message: "Order status updated successfully.",
      order: {
        ...normalizeOrderFees(order),
        items: JSON.parse(order.items)
      }
    });
  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to update order status."
    });
  }
});

// Get single order
app.get("/api/orders/:id", (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid order ID."
      });
    }

    const order = db.prepare(`
      SELECT *
      FROM orders
      WHERE id = ?
    `).get(id);

    if (!order) {
      return res.status(404).json({
        status: "error",
        message: "Order not found."
      });
    }

    return res.json({
      status: "success",
      order: {
        ...normalizeOrderFees(order),
        items: JSON.parse(order.items)
      }
    });
  } catch (error) {
    console.error("Get single order error:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch order."
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    status: "error",
    message: "Internal server error."
  });
});

// Start server
app.listen(PORT, () => {
  console.log("----------------------------------");
  console.log("VELORA BACKEND STARTED");
  console.log(`Server: http://localhost:${PORT}`);
  console.log("Database: Connected");
  console.log("GET    /api/health");
  console.log("GET    /api/stores/:slug");
  console.log("POST   /api/orders");
  console.log("GET    /api/orders");
  console.log("GET    /api/orders/:id");
  console.log("PUT    /api/orders/:id/status");
  console.log("GET    /api/seller/orders");
  console.log("PUT    /api/seller/orders/:id/status");
  console.log("POST   /api/auth/register");
  console.log("POST   /api/auth/login");
  console.log("GET    /api/auth/me");
  console.log("GET    /api/customer/auth/providers");
  console.log("POST   /api/customer/auth/email/request-otp");
  console.log("POST   /api/customer/auth/email/verify-otp");
  console.log("POST   /api/customer/auth/mobile/request-otp");
  console.log("POST   /api/customer/auth/mobile/verify-otp");
  console.log("POST   /api/customer/auth/google");
  console.log("GET    /api/customer/auth/me");
  console.log("GET    /api/products");
  console.log("POST   /api/products");
  console.log("PUT    /api/products/:id");
  console.log("DELETE /api/products/:id");
  console.log("GET    /api/payments/config");
  console.log("POST   /api/payments/create-order");
  console.log("POST   /api/payments/verify");
  console.log("POST   /api/payments/cancel");
  console.log("POST   /api/payments/fail");
  console.log("----------------------------------");
});

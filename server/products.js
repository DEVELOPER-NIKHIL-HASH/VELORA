import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { createSellerAuthenticator } from "./auth.js";
import { calculatePlatformFee, normalizeOrderFees } from "./fees.js";
import { recordOrderDeliverySettlement } from "./financials.js";

const PRODUCTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_UPLOAD_DIR = path.join(PRODUCTS_DIR, "uploads", "products");
const PRODUCT_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function ensureProductUploadDir() {
  fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
}

function createProductUploader() {
  ensureProductUploadDir();

  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      ensureProductUploadDir();
      cb(null, PRODUCT_UPLOAD_DIR);
    },
    filename(_req, file, cb) {
      const ext = PRODUCT_MIME_EXTENSIONS[file.mimetype] || ".jpg";
      const unique = crypto.randomBytes(16).toString("hex");
      cb(null, `product-${Date.now()}-${unique}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: PRODUCT_MAX_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      if (PRODUCT_MIME_EXTENSIONS[file.mimetype]) {
        cb(null, true);
        return;
      }
      cb(new Error("Please upload a JPG, PNG, WEBP, or GIF image."));
    },
  }).any();
}

const ALLOWED_ORDER_STATUSES = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled"
];

const RESERVED_SLUGS = [
  "admin",
  "seller",
  "track-order",
  "api",
  "health",
  "orders",
  "auth"
];

export function registerProductRoutes(app, db, jwtSecret) {
  const authenticateSeller = createSellerAuthenticator(jwtSecret);

  function getSellerStore(userId) {
    return db.prepare(`
      SELECT id, name, slug
      FROM stores
      WHERE owner_user_id = ?
      LIMIT 1
    `).get(userId);
  }

  function isValidProduct(body, partial = false) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return false;
    }

    const allowedFields = [
      "name",
      "description",
      "price",
      "stock",
      "image_url",
      "category",
      "subcategory",
      "is_active",
      "is_published_to_marketplace"
    ];

    if (
      Object.keys(body).some((key) => !allowedFields.includes(key))
    ) {
      return false;
    }

    if (!partial || "name" in body) {
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.trim().length > 200
      ) return false;
    }

    if (!partial || "price" in body) {
      if (
        typeof body.price !== "number" ||
        !Number.isFinite(body.price) ||
        body.price < 0
      ) return false;
    }

    if (!partial || "stock" in body) {
      if (
        !Number.isSafeInteger(body.stock) ||
        body.stock < 0
      ) return false;
    }

    if (
      "description" in body &&
      (typeof body.description !== "string" ||
        body.description.length > 5000)
    ) return false;

    if (
      "image_url" in body &&
      (typeof body.image_url !== "string" ||
        body.image_url.length > 2048)
    ) return false;

    if (
      "category" in body &&
      (typeof body.category !== "string" ||
        body.category.trim().length > 100)
    ) return false;

    if (
      "subcategory" in body &&
      (typeof body.subcategory !== "string" ||
        body.subcategory.trim().length > 100)
    ) return false;

    if (
      "is_active" in body &&
      ![0, 1, true, false].includes(body.is_active)
    ) return false;

    if (
      "is_published_to_marketplace" in body &&
      ![0, 1, true, false].includes(body.is_published_to_marketplace)
    ) return false;

    return true;
  }

  // PUBLIC: GET /api/stores/:slug â€” fetch store info, categories and active products
  app.get("/api/stores/:slug", (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim().toLowerCase();

      if (!slug || slug.length > 100) {
        return res.status(400).json({
          status: "error",
          message: "Invalid store identifier."
        });
      }

      if (RESERVED_SLUGS.includes(slug)) {
        return res.status(404).json({
          status: "error",
          message: "Store not found."
        });
      }

      const store = db.prepare(`
        SELECT s.id, s.name, s.slug, s.description, s.created_at, u.name AS owner_name,
               s.banner_url, s.logo_url, s.theme_color, s.announcement, s.contact_email, s.contact_phone
        FROM stores s
        JOIN users u ON s.owner_user_id = u.id
        WHERE s.slug = ? COLLATE NOCASE
        LIMIT 1
      `).get(slug);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Store not found."
        });
      }

      const products = db.prepare(`
        SELECT id, store_id, name, description, price, stock, image_url, category, is_active, created_at
        FROM products
        WHERE store_id = ? AND is_active = 1
        ORDER BY id DESC
      `).all(store.id);

      const categorySet = new Set(["All"]);
      for (const p of products) {
        if (p.category && p.category.trim()) {
          categorySet.add(p.category.trim());
        }
      }

      return res.json({
        status: "success",
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          description: store.description,
          bannerUrl: store.banner_url || "",
          logoUrl: store.logo_url || "",
          logo_url: store.logo_url || "",
          themeColor: store.theme_color || "#d4af37",
          theme_color: store.theme_color || "#d4af37",
          announcement: store.announcement || "",
          contactEmail: store.contact_email || "",
          contactPhone: store.contact_phone || "",
          ownerName: store.owner_name,
          createdAt: store.created_at
        },
        categories: Array.from(categorySet),
        products
      });
    } catch (error) {
      console.error("Get public store error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch store details."
      });
    }
  });

  // GET /api/products â€” seller's own products
  app.get("/api/products", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const products = db.prepare(`
        SELECT *
        FROM products
        WHERE store_id = ?
        ORDER BY id DESC
      `).all(store.id);

      return res.json({
        status: "success",
        count: products.length,
        store,
        products
      });
    } catch (error) {
      console.error("Get products error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch products."
      });
    }
  });

  // POST /api/products/upload - Authenticated product image upload
  const uploadProductImage = createProductUploader();

  const handleProductImageUpload = (req, res) => {
    const store = getSellerStore(req.seller.id);
    if (!store) {
      return res.status(404).json({
        status: "error",
        message: "Seller store not found."
      });
    }

    uploadProductImage(req, res, (err) => {
      if (err) {
        const fPath = req.file?.path || (req.files && req.files[0]?.path);
        if (fPath && fs.existsSync(fPath)) {
          try { fs.unlinkSync(fPath); } catch (_) {}
        }
        const isSize = err.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({
          status: "error",
          message: isSize
            ? "Product image must be 5MB or smaller."
            : err.message || "Product image upload failed."
        });
      }

      const file =
        req.file ||
        (req.files && req.files.image && req.files.image[0]) ||
        (req.files && req.files.file && req.files.file[0]) ||
        (Array.isArray(req.files) ? req.files[0] : null);

      if (!file) {
        return res.status(400).json({
          status: "error",
          message: "Please select an image file to upload."
        });
      }

      const storedName = path.basename(file.filename);
      const imageUrl = `/uploads/products/${storedName}`;

      return res.json({
        status: "success",
        message: "Product image uploaded successfully.",
        image_url: imageUrl,
        imageUrl: imageUrl,
        url: imageUrl
      });
    });
  };

  app.post("/api/products/upload", authenticateSeller, handleProductImageUpload);
  app.post("/api/products/upload-image", authenticateSeller, handleProductImageUpload);
  app.post("/api/seller/products/upload-image", authenticateSeller, handleProductImageUpload);

  // POST /api/products
  app.post("/api/products", authenticateSeller, (req, res) => {
    try {
      if (!isValidProduct(req.body)) {
        return res.status(400).json({
          status: "error",
          message: "Valid name, price and non-negative integer stock are required."
        });
      }

      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const {
        name,
        description = "",
        price,
        stock,
        image_url = "",
        category = "General",
        subcategory = "",
        is_published_to_marketplace = 1
      } = req.body;

      const cleanCategory = typeof category === "string" && category.trim() ? category.trim() : "General";
      const cleanSubcategory = typeof subcategory === "string" ? subcategory.trim() : "";
      const published = is_published_to_marketplace === 0 || is_published_to_marketplace === false ? 0 : 1;

      const result = db.prepare(`
        INSERT INTO products (
          store_id,
          name,
          description,
          price,
          stock,
          image_url,
          category,
          subcategory,
          is_active,
          is_published_to_marketplace,
          marketplace_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'approved')
      `).run(
        store.id,
        name.trim(),
        description,
        price,
        stock,
        image_url,
        cleanCategory,
        cleanSubcategory,
        published
      );

      const product = db.prepare(`
        SELECT *
        FROM products
        WHERE id = ? AND store_id = ?
      `).get(result.lastInsertRowid, store.id);

      return res.status(201).json({
        status: "success",
        message: "Product created successfully.",
        product
      });
    } catch (error) {
      console.error("Create product error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to create product."
      });
    }
  });

  // PUT /api/products/:id â€” update own product
  app.put("/api/products/:id", authenticateSeller, (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body;

      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid product ID."
        });
      }

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length === 0 ||
        !isValidProduct(body, true)
      ) {
        return res.status(400).json({
          status: "error",
          message: "Provide valid product fields to update."
        });
      }

      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const existing = db.prepare(`
        SELECT id
        FROM products
        WHERE id = ? AND store_id = ?
      `).get(id, store.id);

      if (!existing) {
        return res.status(404).json({
          status: "error",
          message: "Product not found in your store."
        });
      }

      const fields = Object.keys(body);

      const values = fields.map((field) => {
        if (field === "name") return body[field].trim();
        if (field === "category") return body[field].trim() || "General";
        if (field === "subcategory") return typeof body[field] === "string" ? body[field].trim() : "";
        if (field === "is_active") return Number(body[field]);
        if (field === "is_published_to_marketplace") return Number(Boolean(body[field]));
        return body[field];
      });

      const setClause = fields
        .map((field) => `${field} = ?`)
        .join(", ");

      db.prepare(`
        UPDATE products
        SET ${setClause}
        WHERE id = ? AND store_id = ?
      `).run(...values, id, store.id);

      const product = db.prepare(`
        SELECT *
        FROM products
        WHERE id = ? AND store_id = ?
      `).get(id, store.id);

      return res.json({
        status: "success",
        message: "Product updated successfully.",
        product
      });
    } catch (error) {
      console.error("Update product error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to update product."
      });
    }
  });

  // DELETE /api/products/:id â€” delete own product
  app.delete("/api/products/:id", authenticateSeller, (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid product ID."
        });
      }

      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const result = db.prepare(`
        DELETE FROM products
        WHERE id = ? AND store_id = ?
      `).run(id, store.id);

      if (result.changes === 0) {
        return res.status(404).json({
          status: "error",
          message: "Product not found in your store."
        });
      }

      return res.json({
        status: "success",
        message: "Product deleted successfully."
      });
    } catch (error) {
      console.error("Delete product error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to delete product."
      });
    }
  });

  // GET /api/seller/orders — fetch orders belonging to the logged-in seller's store
  app.get("/api/seller/orders", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const rawOrders = db.prepare(`
        SELECT *
        FROM orders
        WHERE store_id = ? OR store_id IS NULL
        ORDER BY id DESC
      `).all(store.id);

      const formattedOrders = [];
      for (const order of rawOrders) {
        let rawItems = [];
        try {
          rawItems = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
        } catch {
          rawItems = [];
        }

        if (order.store_id === store.id) {
          formattedOrders.push({
            ...normalizeOrderFees(order),
            items: rawItems
          });
        } else if (order.store_id === null || order.store_id === undefined) {
          // Check if any items belong to this seller's store
          const sellerItems = Array.isArray(rawItems)
            ? rawItems.filter((it) => Number(it.store_id) === Number(store.id))
            : [];

          if (sellerItems.length > 0) {
            const sellerSubtotal = sellerItems.reduce(
              (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
              0
            );
            const feeData = calculatePlatformFee(sellerSubtotal);
            formattedOrders.push({
              ...normalizeOrderFees(order),
              total: sellerSubtotal,
              platform_fee: feeData.platform_fee,
              seller_payout: feeData.seller_payout,
              fee_rate: feeData.fee_rate,
              items: sellerItems,
              is_marketplace_order: true
            });
          }
        }
      }

      return res.json({
        status: "success",
        store,
        count: formattedOrders.length,
        orders: formattedOrders
      });
    } catch (error) {
      console.error("Get seller orders error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch seller orders."
      });
    }
  });

  // PUT /api/seller/orders/:id/status — update order status for seller's own store
  app.put("/api/seller/orders/:id/status", authenticateSeller, (req, res) => {
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
        !ALLOWED_ORDER_STATUSES.includes(status)
      ) {
        return res.status(400).json({
          status: "error",
          message: "Invalid order status.",
          allowedStatuses: ALLOWED_ORDER_STATUSES
        });
      }

      const store = getSellerStore(req.seller.id);

      if (!store) {
        return res.status(404).json({
          status: "error",
          message: "Seller store not found."
        });
      }

      const existing = db.prepare(`
        SELECT id, total, platform_fee, store_id, items
        FROM orders
        WHERE id = ?
      `).get(id);

      if (!existing) {
        return res.status(404).json({
          status: "error",
          message: "Order not found."
        });
      }

      const isDirectStoreOrder = Number(existing.store_id) === Number(store.id);
      let hasSellerItems = false;
      if (!isDirectStoreOrder && existing.items) {
        try {
          const parsed = JSON.parse(existing.items);
          hasSellerItems = Array.isArray(parsed) && parsed.some((it) => Number(it.store_id) === Number(store.id));
        } catch {
          hasSellerItems = false;
        }
      }

      if (!isDirectStoreOrder && !hasSellerItems) {
        return res.status(404).json({
          status: "error",
          message: "Order not found in your store."
        });
      }

      if (status === "Delivered" && (existing.platform_fee === null || existing.platform_fee === undefined)) {
        const feeDetails = calculatePlatformFee(existing.total);
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

      const updated = db.prepare(`
        SELECT *
        FROM orders
        WHERE id = ?
      `).get(id);

      return res.json({
        status: "success",
        message: "Order status updated successfully.",
        order: {
          ...normalizeOrderFees(updated),
          items: JSON.parse(updated.items)
        }
      });
    } catch (error) {
      console.error("Seller update order status error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to update order status."
      });
    }
  });
}

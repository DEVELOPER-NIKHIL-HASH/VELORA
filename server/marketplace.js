import { createAdminAuthenticator } from "./adminAuth.js";
import { createSellerAuthenticator } from "./auth.js";

/**
 * Safe, idempotent database schema migrations for VELORA Phase 6 Marketplace.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initMarketplaceDatabase(db) {
  const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);

  if (!productCols.includes("subcategory")) {
    db.exec("ALTER TABLE products ADD COLUMN subcategory TEXT DEFAULT ''");
    console.log("Marketplace Migration: Added 'subcategory' column to products.");
  }

  if (!productCols.includes("is_published_to_marketplace")) {
    db.exec("ALTER TABLE products ADD COLUMN is_published_to_marketplace INTEGER NOT NULL DEFAULT 1 CHECK (is_published_to_marketplace IN (0, 1))");
    console.log("Marketplace Migration: Added 'is_published_to_marketplace' column to products.");
  }

  if (!productCols.includes("is_featured")) {
    db.exec("ALTER TABLE products ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1))");
    console.log("Marketplace Migration: Added 'is_featured' column to products.");
  }

  if (!productCols.includes("marketplace_status")) {
    db.exec("ALTER TABLE products ADD COLUMN marketplace_status TEXT NOT NULL DEFAULT 'approved' CHECK (marketplace_status IN ('approved', 'pending', 'rejected', 'hidden'))");
    console.log("Marketplace Migration: Added 'marketplace_status' column to products.");
  }

  // Create indexes for efficient marketplace search, filter, and sorting
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_marketplace_visible
      ON products(is_active, is_published_to_marketplace, marketplace_status);
    CREATE INDEX IF NOT EXISTS idx_products_category
      ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_price
      ON products(price);
    CREATE INDEX IF NOT EXISTS idx_products_featured
      ON products(is_featured);
  `);

  // Seed standard multi-vendor catalog if products table has fewer than 6 products
  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products WHERE is_active = 1").get().count;
  const storeCount = db.prepare("SELECT COUNT(*) AS count FROM stores").get().count;

  if (productCount < 6 && storeCount > 0) {
    const stores = db.prepare("SELECT id FROM stores ORDER BY id ASC").all();
    const s1 = stores[0]?.id || 1;
    const s2 = stores[1]?.id || s1;
    const s3 = stores[2]?.id || s1;

    const seedProducts = [
      {
        store_id: s1,
        name: "Aura Wireless Headphones",
        description: "Architectural acoustic engineering with an anodized aluminum finish and precision planar drivers. Active Noise Cancellation with 42-hour continuous battery.",
        price: 1999,
        stock: 18,
        category: "Audio & Acoustics",
        subcategory: "Wireless Headphones",
        image_url: "/assets/products/headphones.jpg",
        is_featured: 1
      },
      {
        store_id: s2,
        name: "Minimal Smart Watch",
        description: "Understated horology featuring sapphire crystal, aerospace-grade titanium casing, and subtle haptics. Water-resistant to 50 meters.",
        price: 2499,
        stock: 14,
        category: "Horology & Wearables",
        subcategory: "Smart Watches",
        image_url: "/assets/products/watch.jpg",
        is_featured: 1
      },
      {
        store_id: s1,
        name: "Premium Everyday Backpack",
        description: "Sculpted full-grain calfskin and weather-resistant canvas designed for the discerning traveler. Dedicated 16-inch laptop chamber.",
        price: 1299,
        stock: 22,
        category: "Leather & Carry",
        subcategory: "Backpacks",
        image_url: "/assets/products/backpack.jpg",
        is_featured: 1
      },
      {
        store_id: s3,
        name: "Vane Horology Master Tourbillon",
        description: "Mechanical open-heart movement with hand-finished bevels, blued steel screws, and Italian alligator grain leather strap.",
        price: 4999,
        stock: 6,
        category: "Horology & Wearables",
        subcategory: "Mechanical Timepieces",
        image_url: "/assets/products/watch.jpg",
        is_featured: 1
      },
      {
        store_id: s2,
        name: "Bespoke Cashmere Overshirt",
        description: "Pure Mongolian grade-A cashmere crafted with horn buttons and structured architectural tailoring for modern layering.",
        price: 3299,
        stock: 9,
        category: "Apparel & Tailoring",
        subcategory: "Outerwear",
        image_url: "/assets/products/backpack.jpg",
        is_featured: 0
      },
      {
        store_id: s3,
        name: "Obsidian Planar Desk Artifact",
        description: "Hand-sculpted monolithic volcanic obsidian paperweight and pen resting cradle, polished to high-sheen satin finish.",
        price: 899,
        stock: 25,
        category: "Living & Decor",
        subcategory: "Desk Artifacts",
        image_url: "/assets/products/headphones.jpg",
        is_featured: 0
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO products (
        store_id, name, description, price, stock, category, subcategory,
        image_url, is_active, is_published_to_marketplace, is_featured, marketplace_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'approved')
    `);

    for (const p of seedProducts) {
      const exists = db.prepare("SELECT id FROM products WHERE name = ?").get(p.name);
      if (!exists) {
        insertStmt.run(
          p.store_id, p.name, p.description, p.price, p.stock,
          p.category, p.subcategory, p.image_url, p.is_featured
        );
      }
    }
    console.log("Marketplace Catalog: Seeded multi-vendor products across stores.");
  }
}

/**
 * Registers all Common Marketplace REST API endpoints.
 *
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @param {string} adminSecret
 */
export function registerMarketplaceRoutes(app, db, jwtSecret, adminSecret) {
  initMarketplaceDatabase(db);

  const authenticateAdmin = createAdminAuthenticator(adminSecret);
  const authenticateSeller = createSellerAuthenticator(jwtSecret);

  // ===========================================================================
  // 1. PUBLIC: GET /api/marketplace/products
  // Multi-seller product search, filtering, and sorting
  // ===========================================================================
  app.get("/api/marketplace/products", (req, res) => {
    try {
      const {
        search = "",
        category = "",
        subcategory = "",
        store_id = "",
        min_price = "",
        max_price = "",
        in_stock = "",
        featured = "",
        sort = "featured",
        page = "1",
        limit = "24"
      } = req.query ?? {};

      const whereClauses = [
        "p.is_active = 1",
        "p.is_published_to_marketplace = 1",
        "p.marketplace_status = 'approved'"
      ];
      const params = [];

      // Category filter
      if (typeof category === "string" && category.trim() && category.trim().toLowerCase() !== "all") {
        whereClauses.push("LOWER(p.category) = LOWER(?)");
        params.push(category.trim());
      }

      // Subcategory filter
      if (typeof subcategory === "string" && subcategory.trim() && subcategory.trim().toLowerCase() !== "all") {
        whereClauses.push("LOWER(p.subcategory) = LOWER(?)");
        params.push(subcategory.trim());
      }

      // Store filter
      if (store_id !== "" && store_id !== undefined && !isNaN(Number(store_id))) {
        whereClauses.push("p.store_id = ?");
        params.push(Number(store_id));
      }

      // Price range filters
      if (min_price !== "" && !isNaN(Number(min_price))) {
        whereClauses.push("p.price >= ?");
        params.push(Math.max(0, Number(min_price)));
      }
      if (max_price !== "" && !isNaN(Number(max_price))) {
        whereClauses.push("p.price <= ?");
        params.push(Math.max(0, Number(max_price)));
      }

      // In-stock filter
      if (in_stock === "true" || in_stock === "1") {
        whereClauses.push("p.stock > 0");
      }

      // Featured filter
      if (featured === "true" || featured === "1") {
        whereClauses.push("p.is_featured = 1");
      }

      // Full-text search
      if (typeof search === "string" && search.trim()) {
        const term = `%${search.trim().toLowerCase()}%`;
        whereClauses.push(`(
          LOWER(p.name) LIKE ?
          OR LOWER(p.description) LIKE ?
          OR LOWER(p.category) LIKE ?
          OR LOWER(p.subcategory) LIKE ?
          OR LOWER(s.name) LIKE ?
        )`);
        params.push(term, term, term, term, term);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // Sorting
      let orderSql = "ORDER BY p.is_featured DESC, p.id DESC";
      switch (String(sort).toLowerCase()) {
        case "price_asc":
        case "price_low":
          orderSql = "ORDER BY p.price ASC, p.id DESC";
          break;
        case "price_desc":
        case "price_high":
          orderSql = "ORDER BY p.price DESC, p.id DESC";
          break;
        case "newest":
          orderSql = "ORDER BY p.id DESC";
          break;
        case "name_asc":
        case "alpha":
          orderSql = "ORDER BY p.name ASC";
          break;
        case "featured":
        default:
          orderSql = "ORDER BY p.is_featured DESC, p.id DESC";
          break;
      }

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM products p
        JOIN stores s ON p.store_id = s.id
        ${whereSql}
      `;
      const total = db.prepare(countQuery).get(...params).total;

      // Price range summary across all visible products
      const priceSummary = db.prepare(`
        SELECT
          COALESCE(MIN(price), 0) AS min_price,
          COALESCE(MAX(price), 5000) AS max_price
        FROM products
        WHERE is_active = 1 AND is_published_to_marketplace = 1 AND marketplace_status = 'approved'
      `).get();

      // Pagination
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.min(100, Math.max(1, Number(limit) || 24));
      const offset = (pageNum - 1) * limitNum;

      const dataQuery = `
        SELECT
          p.id,
          p.store_id,
          p.name,
          p.description,
          p.price,
          p.stock,
          p.image_url,
          p.category,
          p.subcategory,
          p.is_active,
          p.is_published_to_marketplace,
          p.is_featured,
          p.marketplace_status,
          p.created_at,
          s.name AS store_name,
          s.slug AS store_slug,
          s.logo_url AS store_logo_url,
          s.theme_color AS store_theme_color,
          s.announcement AS store_announcement
        FROM products p
        JOIN stores s ON p.store_id = s.id
        ${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?
      `;

      const products = db.prepare(dataQuery).all(...params, limitNum, offset);

      return res.json({
        status: "success",
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        priceRange: {
          min: priceSummary.min_price,
          max: priceSummary.max_price
        },
        products
      });
    } catch (error) {
      console.error("Get marketplace products error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch marketplace products."
      });
    }
  });

  // ===========================================================================
  // 2. PUBLIC: GET /api/marketplace/categories
  // Categories and subcategories taxonomy with product counts
  // ===========================================================================
  app.get("/api/marketplace/categories", (_req, res) => {
    try {
      const rows = db.prepare(`
        SELECT
          p.category,
          p.subcategory,
          COUNT(*) AS count
        FROM products p
        WHERE p.is_active = 1
          AND p.is_published_to_marketplace = 1
          AND p.marketplace_status = 'approved'
        GROUP BY p.category, p.subcategory
        ORDER BY p.category ASC, p.subcategory ASC
      `).all();

      const categoryMap = new Map();

      for (const row of rows) {
        const cat = row.category ? row.category.trim() : "General";
        const subcat = row.subcategory ? row.subcategory.trim() : "";

        if (!categoryMap.has(cat)) {
          categoryMap.set(cat, {
            name: cat,
            count: 0,
            subcategories: []
          });
        }

        const entry = categoryMap.get(cat);
        entry.count += row.count;
        if (subcat && !entry.subcategories.includes(subcat)) {
          entry.subcategories.push(subcat);
        }
      }

      return res.json({
        status: "success",
        categories: Array.from(categoryMap.values())
      });
    } catch (error) {
      console.error("Get marketplace categories error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch categories."
      });
    }
  });

  // ===========================================================================
  // 3. PUBLIC: GET /api/marketplace/products/:id
  // Single product detail view with store info and related products
  // ===========================================================================
  app.get("/api/marketplace/products/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid product ID." });
      }

      const product = db.prepare(`
        SELECT
          p.*,
          s.name AS store_name,
          s.slug AS store_slug,
          s.description AS store_description,
          s.logo_url AS store_logo_url,
          s.banner_url AS store_banner_url,
          s.theme_color AS store_theme_color,
          s.announcement AS store_announcement
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.id = ? AND p.is_active = 1 AND p.is_published_to_marketplace = 1 AND p.marketplace_status = 'approved'
      `).get(id);

      if (!product) {
        return res.status(404).json({
          status: "error",
          message: "Product not found or currently unavailable in the marketplace."
        });
      }

      // Related products from same category or same store
      const related = db.prepare(`
        SELECT
          p.id, p.store_id, p.name, p.price, p.stock, p.image_url, p.category, p.subcategory,
          s.name AS store_name, s.slug AS store_slug
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.id != ?
          AND p.is_active = 1
          AND p.is_published_to_marketplace = 1
          AND p.marketplace_status = 'approved'
          AND (p.category = ? OR p.store_id = ?)
        LIMIT 4
      `).all(product.id, product.category, product.store_id);

      return res.json({
        status: "success",
        product,
        related
      });
    } catch (error) {
      console.error("Get marketplace product detail error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch product details."
      });
    }
  });

  // ===========================================================================
  // 4. PUBLIC: GET /api/marketplace/stores
  // Multi-seller discovery: list active sellers and their published product counts
  // ===========================================================================
  app.get("/api/marketplace/stores", (_req, res) => {
    try {
      const stores = db.prepare(`
        SELECT
          s.id,
          s.name,
          s.slug,
          s.description,
          s.logo_url,
          s.banner_url,
          s.theme_color,
          s.announcement,
          COUNT(p.id) AS products_count
        FROM stores s
        LEFT JOIN products p
          ON s.id = p.store_id
          AND p.is_active = 1
          AND p.is_published_to_marketplace = 1
          AND p.marketplace_status = 'approved'
        GROUP BY s.id
        ORDER BY products_count DESC, s.name ASC
      `).all();

      return res.json({
        status: "success",
        count: stores.length,
        stores
      });
    } catch (error) {
      console.error("Get marketplace stores error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch marketplace stores."
      });
    }
  });

  // ===========================================================================
  // 5. ADMIN: GET /api/admin/marketplace/products
  // Admin oversight over all marketplace products
  // ===========================================================================
  app.get("/api/admin/marketplace/products", authenticateAdmin, (req, res) => {
    try {
      const { search, status, store_id } = req.query ?? {};
      const whereClauses = ["1=1"];
      const params = [];

      if (typeof search === "string" && search.trim()) {
        const term = `%${search.trim().toLowerCase()}%`;
        whereClauses.push("(LOWER(p.name) LIKE ? OR LOWER(s.name) LIKE ?)");
        params.push(term, term);
      }

      if (status && ["approved", "pending", "rejected", "hidden"].includes(String(status))) {
        whereClauses.push("p.marketplace_status = ?");
        params.push(String(status));
      }

      if (store_id && !isNaN(Number(store_id))) {
        whereClauses.push("p.store_id = ?");
        params.push(Number(store_id));
      }

      const products = db.prepare(`
        SELECT
          p.*,
          s.name AS store_name,
          s.slug AS store_slug,
          u.email AS seller_email
        FROM products p
        JOIN stores s ON p.store_id = s.id
        JOIN users u ON s.owner_user_id = u.id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY p.id DESC
      `).all(...params);

      return res.json({
        status: "success",
        count: products.length,
        products
      });
    } catch (error) {
      console.error("Admin get marketplace products error:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch admin marketplace products."
      });
    }
  });

  // ===========================================================================
  // 6. ADMIN: PUT /api/admin/marketplace/products/:id/feature
  // Toggle featured status of a marketplace product
  // ===========================================================================
  app.put("/api/admin/marketplace/products/:id/feature", authenticateAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid product ID." });
      }

      const existing = db.prepare("SELECT id, is_featured FROM products WHERE id = ?").get(id);
      if (!existing) {
        return res.status(404).json({ status: "error", message: "Product not found." });
      }

      const newFeatured = req.body?.is_featured !== undefined
        ? (req.body.is_featured ? 1 : 0)
        : (existing.is_featured ? 0 : 1);

      db.prepare("UPDATE products SET is_featured = ? WHERE id = ?").run(newFeatured, id);
      const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(id);

      return res.json({
        status: "success",
        message: `Product ${newFeatured ? "featured" : "unfeatured"} in marketplace.`,
        product: updated
      });
    } catch (error) {
      console.error("Admin toggle product feature error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update feature status." });
    }
  });

  // ===========================================================================
  // 7. ADMIN: PUT /api/admin/marketplace/products/:id/status
  // Update marketplace status (approved, rejected, hidden)
  // ===========================================================================
  app.put("/api/admin/marketplace/products/:id/status", authenticateAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid product ID." });
      }

      const { marketplace_status } = req.body ?? {};
      const allowed = ["approved", "pending", "rejected", "hidden"];
      if (!allowed.includes(marketplace_status)) {
        return res.status(400).json({
          status: "error",
          message: `Invalid marketplace status. Must be one of: ${allowed.join(", ")}`
        });
      }

      const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
      if (!existing) {
        return res.status(404).json({ status: "error", message: "Product not found." });
      }

      db.prepare("UPDATE products SET marketplace_status = ? WHERE id = ?").run(marketplace_status, id);
      const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(id);

      return res.json({
        status: "success",
        message: `Marketplace status updated to ${marketplace_status}.`,
        product: updated
      });
    } catch (error) {
      console.error("Admin update marketplace status error:", error);
      return res.status(500).json({ status: "error", message: "Failed to update marketplace status." });
    }
  });
}

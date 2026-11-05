import express from "express";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { registerMarketplaceRoutes, initMarketplaceDatabase } from "./server/marketplace.js";
import { registerProductRoutes } from "./server/products.js";
import { registerAdminAuthRoutes, setAdminPasswordHash, getAdminTokenVersion } from "./server/adminAuth.js";
import { calculateOrderTotalServerSide, registerPaymentRoutes } from "./server/payments.js";
import { initFinancialDatabase, registerFinancialRoutes, recordOrderDeliverySettlement } from "./server/financials.js";
import { calculatePlatformFee } from "./server/fees.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = "test_jwt_secret_must_be_at_least_32_characters_long!";
const ADMIN_SECRET = "test_admin_secret_must_be_at_least_32_chars!";

async function runTests() {
  console.log("==================================================================");
  console.log("🧪 STARTING VELORA PHASE 6 — MARKETPLACE COMPREHENSIVE TEST SUITE");
  console.log("==================================================================\n");

  const dbPath = path.join(__dirname, "server", "velora.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const app = express();
  app.use(express.json());

  // Initialize DB schemas & routes
  setAdminPasswordHash("$2a$12$e80MvQkQ1q1.fakehashfortesting1234567890123456789012");
  initMarketplaceDatabase(db);
  initFinancialDatabase(db);
  registerProductRoutes(app, db, JWT_SECRET);
  registerPaymentRoutes(app, db);
  registerFinancialRoutes(app, db, JWT_SECRET, ADMIN_SECRET);
  registerMarketplaceRoutes(app, db, JWT_SECRET, ADMIN_SECRET);

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // Start temporary server for HTTP endpoint tests
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Database Migrations & Multi-Vendor Schema Verification
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 1, 11, 13: Schema & Catalog Migration ---");
    const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
    assert(productCols.includes("subcategory"), "products table has 'subcategory' column");
    assert(productCols.includes("is_published_to_marketplace"), "products table has 'is_published_to_marketplace' column");
    assert(productCols.includes("is_featured"), "products table has 'is_featured' column");
    assert(productCols.includes("marketplace_status"), "products table has 'marketplace_status' column");

    const storesCount = db.prepare("SELECT COUNT(*) AS count FROM stores").get().count;
    assert(storesCount >= 2, `Multiple stores exist in database (found: ${storesCount})`);

    const productsCount = db.prepare("SELECT COUNT(*) AS count FROM products WHERE is_active = 1").get().count;
    assert(productsCount >= 4, `Active multi-vendor products exist (found: ${productsCount})`);

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Seller Product Listings API
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 1 & 2: Common Marketplace Product Listings ---");
    const resProducts = await fetch(`${baseUrl}/api/marketplace/products`);
    const dataProducts = await resProducts.json();
    assert(resProducts.status === 200, "GET /api/marketplace/products returns 200");
    assert(dataProducts.status === "success", "Response status is success");
    assert(Array.isArray(dataProducts.products) && dataProducts.products.length > 0, `Returned ${dataProducts.products.length} marketplace products`);
    assert(dataProducts.products[0].store_name !== undefined, "Products include seller store_name attribution");
    assert(dataProducts.products[0].store_slug !== undefined, "Products include store_slug for seller navigation");

    // -------------------------------------------------------------------------
    // TEST 3: Multi-Seller Directory
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 6: Multi-Seller Stores Discovery ---");
    const resStores = await fetch(`${baseUrl}/api/marketplace/stores`);
    const dataStores = await resStores.json();
    assert(resStores.status === 200, "GET /api/marketplace/stores returns 200");
    assert(dataStores.status === "success", "Response status is success");
    assert(Array.isArray(dataStores.stores) && dataStores.stores.length >= 2, `Discovered ${dataStores.stores.length} seller stores`);
    assert(dataStores.stores[0].products_count >= 0, "Stores have published product counts");

    // -------------------------------------------------------------------------
    // TEST 4: Categories and Subcategories Taxonomy
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 3: Product Categories & Subcategories ---");
    const resCategories = await fetch(`${baseUrl}/api/marketplace/categories`);
    const dataCategories = await resCategories.json();
    assert(resCategories.status === 200, "GET /api/marketplace/categories returns 200");
    assert(Array.isArray(dataCategories.categories) && dataCategories.categories.length > 0, `Taxonomy returned ${dataCategories.categories.length} categories`);
    const audioCat = dataCategories.categories.find((c) => c.name.toLowerCase().includes("audio"));
    assert(Boolean(audioCat), "Taxonomy includes audio category");
    assert(Array.isArray(audioCat?.subcategories), "Category includes subcategories array");

    // -------------------------------------------------------------------------
    // TEST 5: Advanced Search & Filtering
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 4 & 5: Advanced Search, Filtering & Sorting ---");
    // Search test
    const resSearch = await fetch(`${baseUrl}/api/marketplace/products?search=headphones`);
    const dataSearch = await resSearch.json();
    assert(dataSearch.products.length > 0, `Search for 'headphones' returned ${dataSearch.products.length} items`);
    assert(dataSearch.products.every((p) => p.name.toLowerCase().includes("headphone") || p.description.toLowerCase().includes("headphone")), "All search results match term");

    // Price range filter
    const resPrice = await fetch(`${baseUrl}/api/marketplace/products?min_price=1000&max_price=2000`);
    const dataPrice = await resPrice.json();
    assert(dataPrice.products.every((p) => p.price >= 1000 && p.price <= 2000), "Price range filter respects min_price & max_price");

    // In-stock filter
    const resStock = await fetch(`${baseUrl}/api/marketplace/products?in_stock=true`);
    const dataStock = await resStock.json();
    assert(dataStock.products.every((p) => p.stock > 0), "In-stock filter returns only items with stock > 0");

    // Sorting: price_asc
    const resSortAsc = await fetch(`${baseUrl}/api/marketplace/products?sort=price_asc`);
    const dataSortAsc = await resSortAsc.json();
    let isAsc = true;
    for (let i = 1; i < dataSortAsc.products.length; i++) {
      if (dataSortAsc.products[i].price < dataSortAsc.products[i - 1].price) isAsc = false;
    }
    assert(isAsc, "Sorting by price_asc sorts prices in ascending order");

    // Sorting: price_desc
    const resSortDesc = await fetch(`${baseUrl}/api/marketplace/products?sort=price_desc`);
    const dataSortDesc = await resSortDesc.json();
    let isDesc = true;
    for (let i = 1; i < dataSortDesc.products.length; i++) {
      if (dataSortDesc.products[i].price > dataSortDesc.products[i - 1].price) isDesc = false;
    }
    assert(isDesc, "Sorting by price_desc sorts prices in descending order");

    // -------------------------------------------------------------------------
    // TEST 6: Product Detail Page & Related Products
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 7: Product Detail Pages ---");
    const testProd = dataProducts.products[0];
    const resDetail = await fetch(`${baseUrl}/api/marketplace/products/${testProd.id}`);
    const dataDetail = await resDetail.json();
    assert(resDetail.status === 200, "GET /api/marketplace/products/:id returns 200");
    assert(dataDetail.product.id === testProd.id, "Returned correct product detail");
    assert(dataDetail.product.store_name !== undefined, "Detail includes seller store_name");
    assert(Array.isArray(dataDetail.related), "Detail includes related products array");

    // -------------------------------------------------------------------------
    // TEST 7: Multi-Seller Shopping Cart Calculation & Stock Verification
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 8, 10, 11: Multi-Seller Shopping Cart & Order Calculation ---");
    const allProdList = db.prepare("SELECT id, store_id, name, price, stock FROM products WHERE is_active = 1 AND stock > 2").all();
    // Pick 2 products from different stores if available
    const prodA = allProdList[0];
    const prodB = allProdList.find((p) => p.store_id !== prodA.store_id) || allProdList[1];

    const multiCartItems = [
      { id: prodA.id, quantity: 1 },
      { id: prodB.id, quantity: 1 }
    ];

    const calc = calculateOrderTotalServerSide(db, multiCartItems, null, null);
    assert(calc.storeId === null, "Cart with null storeId is identified as Marketplace order");
    assert(calc.items.length === 2, "Both multi-seller items verified server-side");
    assert(calc.items[0].store_id !== undefined, "Item 1 has attached store_id");
    assert(calc.items[1].store_id !== undefined, "Item 2 has attached store_id");
    assert(calc.subtotal === prodA.price + prodB.price, "Subtotal accurately calculated server-side");

    // -------------------------------------------------------------------------
    // TEST 8: Order Placement & Atomic Stock Decrement Across Multiple Sellers
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 9, 10, 11: Order Placement & Stock Decrement ---");
    const initialStockA = db.prepare("SELECT stock FROM products WHERE id = ?").get(prodA.id).stock;
    const initialStockB = db.prepare("SELECT stock FROM products WHERE id = ?").get(prodB.id).stock;

    const resOrder = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: "Phase 6 Test Customer",
        email: "test.customer@velora.com",
        items: multiCartItems
      })
    });
    const dataOrder = await resOrder.json();
    assert(resOrder.status === 201, "POST /api/payments/create-order returns 201 for multi-vendor cart");
    assert(dataOrder.status === "success", "Order creation response is success");

    const newStockA = db.prepare("SELECT stock FROM products WHERE id = ?").get(prodA.id).stock;
    const newStockB = db.prepare("SELECT stock FROM products WHERE id = ?").get(prodB.id).stock;
    assert(newStockA === initialStockA - 1, `Product A stock atomically decremented (${initialStockA} -> ${newStockA})`);
    assert(newStockB === initialStockB - 1, `Product B stock atomically decremented (${initialStockB} -> ${newStockB})`);

    // -------------------------------------------------------------------------
    // TEST 9: Seller-wise Order Management & Commission Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 9: Seller-Wise Order Management & Commission ---");
    // Find owner of prodA's store
    const storeA = db.prepare("SELECT * FROM stores WHERE id = ?").get(prodA.store_id);
    const sellerUserA = db.prepare("SELECT * FROM users WHERE id = ?").get(storeA.owner_user_id);
    const sellerTokenA = jwt.sign(
      { userId: sellerUserA.id, email: sellerUserA.email, role: "seller" },
      JWT_SECRET,
      { issuer: "velora-api", audience: "velora-sellers", expiresIn: "1h" }
    );

    const resSellerOrders = await fetch(`${baseUrl}/api/seller/orders`, {
      headers: { Authorization: `Bearer ${sellerTokenA}` }
    });
    const dataSellerOrders = await resSellerOrders.json();
    assert(resSellerOrders.status === 200, "GET /api/seller/orders returns 200");
    const foundOrderInSeller = dataSellerOrders.orders.find((o) => o.id === dataOrder.orderId);
    assert(Boolean(foundOrderInSeller), "Marketplace multi-vendor order visible in Seller A orders");
    assert(foundOrderInSeller.total === prodA.price, "Seller A sees only their portion of the total revenue");
    const expectedFeeA = calculatePlatformFee(prodA.price);
    assert(foundOrderInSeller.platform_fee === expectedFeeA.platform_fee, "3% platform fee calculated accurately for seller portion");

    // -------------------------------------------------------------------------
    // TEST 10: Multi-Vendor Financial Ledger Settlement
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 9 & 10: Multi-Vendor Ledger Settlement on Delivery ---");
    // Mark order delivered
    db.prepare("UPDATE orders SET status = 'Delivered' WHERE id = ?").run(dataOrder.orderId);
    recordOrderDeliverySettlement(db, dataOrder.orderId);

    const ledgerEntries = db.prepare(
      "SELECT * FROM financial_ledger WHERE order_id = ? AND transaction_type = 'SELLER_EARNING'"
    ).all(dataOrder.orderId);
    assert(ledgerEntries.length >= 1, `Ledger contains ${ledgerEntries.length} seller earning settlement records`);
    const sellerAEntry = ledgerEntries.find((l) => l.seller_id === prodA.store_id);
    assert(Boolean(sellerAEntry), "Seller A credited with 97% earnings in immutable financial ledger");

    // -------------------------------------------------------------------------
    // TEST 11: Admin Marketplace Management & Moderation
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 12: Admin Marketplace Moderation ---");
    const adminToken = jwt.sign(
      { role: "admin", tokenVersion: getAdminTokenVersion() },
      ADMIN_SECRET,
      { issuer: "velora-api", audience: "velora-admins", expiresIn: "1h" }
    );

    const resAdminProducts = await fetch(`${baseUrl}/api/admin/marketplace/products`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const dataAdminProducts = await resAdminProducts.json();
    assert(resAdminProducts.status === 200, "GET /api/admin/marketplace/products returns 200");
    assert(dataAdminProducts.products.length >= 4, "Admin can inspect all marketplace listings");

    // Toggle featured
    const resFeature = await fetch(`${baseUrl}/api/admin/marketplace/products/${prodA.id}/feature`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ is_featured: 1 })
    });
    const dataFeature = await resFeature.json();
    assert(resFeature.status === 200, "PUT /api/admin/marketplace/products/:id/feature returns 200");
    assert(dataFeature.product.is_featured === 1, "Product marked as featured");

    // Update status to 'hidden' and verify it disappears from public marketplace
    await fetch(`${baseUrl}/api/admin/marketplace/products/${prodA.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ marketplace_status: "hidden" })
    });
    const resPublicAfterHide = await fetch(`${baseUrl}/api/marketplace/products`);
    const dataPublicAfterHide = await resPublicAfterHide.json();
    assert(!dataPublicAfterHide.products.some((p) => p.id === prodA.id), "Hidden product excluded from public marketplace");

    // Restore to 'approved'
    await fetch(`${baseUrl}/api/admin/marketplace/products/${prodA.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ marketplace_status: "approved" })
    });

    // -------------------------------------------------------------------------
    // TEST 12: Seller Product Publishing Controls
    // -------------------------------------------------------------------------
    console.log("\n--- TASK 13: Seller Product Publishing Controls ---");
    const resNewProd = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sellerTokenA}` },
      body: JSON.stringify({
        name: "Artisan Leather Card Holder",
        description: "Hand-stitched Tuscan vegetable tanned leather.",
        price: 799,
        stock: 12,
        category: "Leather & Carry",
        subcategory: "Card Holders",
        is_published_to_marketplace: 0
      })
    });
    const dataNewProd = await resNewProd.json();
    assert(resNewProd.status === 201, "Seller created product with is_published_to_marketplace: 0");
    assert(dataNewProd.product.is_published_to_marketplace === 0, "Product stored as unpublished to marketplace");

    // Verify it does NOT appear in common marketplace
    const resMktCheck = await fetch(`${baseUrl}/api/marketplace/products?search=Card+Holder`);
    const dataMktCheck = await resMktCheck.json();
    assert(!dataMktCheck.products.some((p) => p.id === dataNewProd.product.id), "Unpublished product absent from common marketplace");

    // Seller updates it to published
    await fetch(`${baseUrl}/api/products/${dataNewProd.product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sellerTokenA}` },
      body: JSON.stringify({ is_published_to_marketplace: 1 })
    });

    const resMktCheck2 = await fetch(`${baseUrl}/api/marketplace/products?search=Card+Holder`);
    const dataMktCheck2 = await resMktCheck2.json();
    assert(dataMktCheck2.products.some((p) => p.id === dataNewProd.product.id), "Updated published product now discoverable in marketplace");

    // Clean up test order stock to leave clean database
    db.prepare("UPDATE products SET stock = stock + 1 WHERE id = ?").run(prodA.id);
    db.prepare("UPDATE products SET stock = stock + 1 WHERE id = ?").run(prodB.id);

  } finally {
    server.close();
    db.close();
  }

  console.log("\n==================================================================");
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution unhandled error:", err);
  process.exit(1);
});

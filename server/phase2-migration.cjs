const Database = require("better-sqlite3");
const path = require("node:path");

const db = new Database(path.join(__dirname, "velora.db"));

try {
  db.pragma("foreign_keys = ON");

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'seller'
          CHECK (role IN ('seller', 'admin')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id)
          REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL CHECK (price >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        image_url TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
          CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id)
          REFERENCES stores(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_stores_owner
        ON stores(owner_user_id);

      CREATE INDEX IF NOT EXISTS idx_products_store
        ON products(store_id);
    `);
  });

  migrate();

  console.log("Phase 2.1 migration successful.");
  console.log("Existing orders:", db.prepare(
    "SELECT COUNT(*) AS count FROM orders"
  ).get().count);

  for (const table of ["users", "stores", "products"]) {
    console.log(
      table + " rows:",
      db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count
    );
  }
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}

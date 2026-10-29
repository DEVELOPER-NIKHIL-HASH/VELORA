const Database = require("better-sqlite3");
const db = new Database("./server/velora.db");

for (const table of ["users", "stores", "products", "orders"]) {
  const result = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
  console.log(`${table}: ${result.count} rows`);
}

db.close();

const db = require("better-sqlite3")("./velora.db");

const tables = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
`).all();

for (const table of tables) {
  console.log("\nTABLE:", table.name);
  console.log(table.sql);
}

db.close();

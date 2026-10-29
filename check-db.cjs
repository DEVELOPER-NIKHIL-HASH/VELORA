const Database = require("better-sqlite3");
const db = new Database("./server/velora.db");

const tables = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
`).all();

console.log(JSON.stringify(tables, null, 2));
db.close();

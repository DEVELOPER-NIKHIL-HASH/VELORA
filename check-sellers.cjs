const Database = require("better-sqlite3");
const db = new Database("./server/velora.db");

console.log("SELLERS:");
console.log(db.prepare(
  "SELECT id, name, email, role FROM users"
).all());

console.log("STORES:");
console.log(db.prepare(
  "SELECT id, owner_user_id, name, slug FROM stores"
).all());

db.close();

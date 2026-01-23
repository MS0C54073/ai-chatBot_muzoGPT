import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE foo (bar TEXT)");
db.run("INSERT INTO foo (bar) VALUES (?)", ["baz"]);
const result = db.query("SELECT * FROM foo").get();
console.log(JSON.stringify(result));

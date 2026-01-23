import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "example.xlsx");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Sample data
const data = [
  ["Item", "Quantity", "Price", "Total", "Notes"],
  ["Widget", 5, 10.5, 52.5, "In Stock"],
  ["Gadget", 2, 25.0, 50.0, "Low Stock"],
  ["Doodad", 10, 1.99, 19.9, "Clearance"],
  ["Thingamajig", 1, 99.99, 99.99, "Special Order"],
  ["Doohickey", 0, 5.0, 0, "Out of Stock"],
];

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

// Write to file
XLSX.writeFile(wb, FILE_PATH);

console.log(`Successfully generated ${FILE_PATH}`);

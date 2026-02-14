/**
 * XLSX Tools Module
 * 
 * Provides server-side utilities for reading and writing Excel files (.xlsx).
 * Used by the chat API to enable spreadsheet manipulation through generative UI tools.
 * 
 * Features:
 * - Read ranges of cells and return values in 2D array format
 * - Update individual cells with type preservation (string, number, boolean)
 * - Explain formulas in cells (extract formula text with simple explanation)
 * - Automatic handling of cell types and date conversion
 * 
 * Important: The XLSX file must exist at ./data/example.xlsx
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export type CellValue = string | number | boolean | null;

/**
 * Result of reading a cell range
 * @property {string} sheet - Name of the sheet that was read
 * @property {string} range - The A1 range notation that was read (e.g., "A1:C5")
 * @property {CellValue[][]} values - 2D array of cell values (rows x columns)
 */
export type RangeResult = {
  sheet: string;
  range: string;
  values: CellValue[][];
};

/**
 * Result of updating a single cell
 * @property {string} sheet - Name of the sheet that was updated
 * @property {string} cell - The cell address (e.g., "A1")
 * @property {CellValue} previous - The old cell value before the update
 * @property {CellValue} updated - The new cell value after the update
 */
export type UpdateCellResult = {
  sheet: string;
  cell: string;
  previous: CellValue;
  updated: CellValue;
};

/**
 * Result of explaining a formula
 * @property {string} sheet - Name of the sheet containing the cell
 * @property {string} cell - The cell address (e.g., "A1")
 * @property {string | null} formula - The formula text if present, or null
 * @property {string} explanation - Human-readable explanation of the formula
 */
export type FormulaResult = {
  sheet: string;
  cell: string;
  formula: string | null;
  explanation: string;
};

const DATA_PATH = path.join(process.cwd(), "data", "example.xlsx");

/**
 * Checks if the XLSX file exists. If not, throws a descriptive error.
 * This is called before every operation to provide clear feedback to the user.
 * @throws {Error} If the XLSX file is missing at the expected path
 */
function ensureWorkbookExists() {
  if (fs.existsSync(DATA_PATH)) {
    return;
  }

  throw new Error(
    `Missing XLSX file at ${DATA_PATH}. Add /data/example.xlsx to enable XLSX tools.`
  );
}

/**
 * Loads the XLSX workbook from disk with full support for formulas and cell metadata.
 * Enables cell formulas, dates, and number formats for accurate data representation.
 * @returns {XLSX.WorkBook} The loaded Excel workbook
 * @throws {Error} If the file cannot be read
 */
function loadWorkbook() {
  ensureWorkbookExists();
  return XLSX.readFile(DATA_PATH, {
    cellFormula: true,  // Preserve cell formulas for explainFormula
    cellDates: true,    // Parse dates as Date objects
    cellNF: true,       // Preserve number formats
  });
}

/**
 * Retrieves a worksheet from the workbook by name.
 * If no name is provided, returns the first sheet.
 * @param {XLSX.WorkBook} workbook - The loaded workbook
 * @param {string} [sheetName] - The sheet name to retrieve (optional)
 * @returns {XLSX.WorkSheet} The requested worksheet
 * @throws {Error} If the sheet name is invalid or workbook has no sheets
 */
function getSheet(
  workbook: XLSX.WorkBook,
  sheetName?: string
): XLSX.WorkSheet {
  const targetName = sheetName ?? workbook.SheetNames[0];
  if (!targetName) {
    throw new Error("Workbook has no sheets.");
  }
  const sheet = workbook.Sheets[targetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${targetName}`);
  }
  return sheet;
}

/**
 * Normalizes a cell value from the XLSX format to a JavaScript primitive.
 * Handles null, dates, numbers, strings, and booleans.
 * Dates are converted to ISO strings for serialization.
 * @param {XLSX.CellObject} [cell] - The cell object to normalize
 * @returns {CellValue} The normalized value (string | number | boolean | null)
 */
function normalizeCellValue(cell?: XLSX.CellObject): CellValue {
  if (!cell || cell.v === undefined || cell.v === null) {
    return null;
  }
  if (cell.v instanceof Date) {
    return cell.v.toISOString();
  }
  if (typeof cell.v === "number" || typeof cell.v === "string") {
    return cell.v;
  }
  if (typeof cell.v === "boolean") {
    return cell.v;
  }
  return String(cell.v);
}

/**
 * Reads a range of cells from the XLSX file and returns their values.
 * 
 * Usage examples:
 * - getRange("A1:C5") - Read a rectangular range
 * - getRange("A1:C5", "Sheet2") - Read from a specific sheet
 * 
 * @param {string} range - A1 notation range (e.g., "A1:C5" or "Sheet1!A1:C5")
 * @param {string} [sheetName] - Optional sheet name; defaults to first sheet
 * @returns {RangeResult} Object with sheet name, range, and 2D array of values
 * @throws {Error} If the range is invalid or file not found
 */
export function getRange(
  range: string,
  sheetName?: string
): RangeResult {
  // Decode the A1 range and return a rectangular grid of values.
  const workbook = loadWorkbook();
  const sheet = getSheet(workbook, sheetName);
  const worksheetRange = XLSX.utils.decode_range(range);
  const values: CellValue[][] = [];

  // Iterate through each cell in the range and collect normalized values
  for (let row = worksheetRange.s.r; row <= worksheetRange.e.r; row += 1) {
    const rowValues: CellValue[] = [];
    for (let col = worksheetRange.s.c; col <= worksheetRange.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      rowValues.push(normalizeCellValue(sheet[address]));
    }
    values.push(rowValues);
  }

  const sheetNameResolved = sheetName ?? workbook.SheetNames[0];
  return {
    sheet: sheetNameResolved ?? "Sheet1",
    range,
    values,
  };
}

/**
 * Updates a single cell value in the XLSX file and saves the changes to disk.
 * 
 * Handles cell type preservation:
 * - Numbers stay as numbers (type 'n')
 * - Booleans stay as booleans (type 'b')
 * - Everything else becomes a string (type 's')
 * - Null deletes the cell
 * 
 * Also updates the sheet's used range (!ref) if the cell falls outside the current bounds.
 * 
 * @param {string} cell - Cell address (e.g., "A1")
 * @param {CellValue} value - New value (string | number | boolean | null)
 * @param {string} [sheetName] - Optional sheet name; defaults to first sheet
 * @returns {UpdateCellResult} Object with sheet name, cell, previous value, and updated value
 * @throws {Error} If the file not found or write operation fails
 */
export function updateCell(
  cell: string,
  value: CellValue,
  sheetName?: string
): UpdateCellResult {
  // Write a single cell and update the sheet range if needed.
  const workbook = loadWorkbook();
  const sheetNameResolved = sheetName ?? workbook.SheetNames[0] ?? "Sheet1";
  const sheet = getSheet(workbook, sheetNameResolved);
  const previous = normalizeCellValue(sheet[cell]);

  if (value === null) {
    // Null means delete the cell
    delete sheet[cell];
  } else {
    // Determine cell type based on value type
    const cellType =
      typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s";
    sheet[cell] = { t: cellType, v: value };
    
    // Update the sheet's used range to include this cell if it's outside current bounds
    const address = XLSX.utils.decode_cell(cell);
    const range = sheet["!ref"]
      ? XLSX.utils.decode_range(sheet["!ref"])
      : { s: address, e: address };
    if (address.r < range.s.r) range.s.r = address.r;
    if (address.c < range.s.c) range.s.c = address.c;
    if (address.r > range.e.r) range.e.r = address.r;
    if (address.c > range.e.c) range.e.c = address.c;
    sheet["!ref"] = XLSX.utils.encode_range(range);
  }

  // Persist changes to disk
  XLSX.writeFile(workbook, DATA_PATH, { bookType: "xlsx" });

  return {
    sheet: sheetNameResolved,
    cell,
    previous,
    updated: value,
  };
}

/**
 * Extracts and explains a formula from a cell (if present).
 * 
 * If the cell contains a formula, returns the formula text and a simple explanation.
 * If there's no formula, returns a message indicating the cell is formula-free.
 * 
 * @param {string} cell - Cell address (e.g., "A1")
 * @param {string} [sheetName] - Optional sheet name; defaults to first sheet
 * @returns {FormulaResult} Object with sheet name, cell, formula text, and explanation
 * @throws {Error} If the file not found or sheet doesn't exist
 */
export function explainFormula(
  cell: string,
  sheetName?: string
): FormulaResult {
  const workbook = loadWorkbook();
  const sheetNameResolved = sheetName ?? workbook.SheetNames[0] ?? "Sheet1";
  const sheet = getSheet(workbook, sheetNameResolved);
  const target = sheet[cell];
  const formula = target?.f ?? null;

  return {
    sheet: sheetNameResolved,
    cell,
    formula,
    explanation: formula
      ? `The cell uses the formula ${formula}.`
      : "This cell does not contain a formula.",
  };
}

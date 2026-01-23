import "server-only";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export type CellValue = string | number | boolean | null;

export type RangeResult = {
  sheet: string;
  range: string;
  values: CellValue[][];
};

export type UpdateCellResult = {
  sheet: string;
  cell: string;
  previous: CellValue;
  updated: CellValue;
};

export type FormulaResult = {
  sheet: string;
  cell: string;
  formula: string | null;
  explanation: string;
};

const DATA_PATH = path.join(process.cwd(), "data", "example.xlsx");

function ensureWorkbookExists() {
  if (fs.existsSync(DATA_PATH)) {
    return;
  }

  // Explicit error for missing XLSX so tools can surface a clear message.
  throw new Error(
    `Missing XLSX file at ${DATA_PATH}. Add /data/example.xlsx to enable XLSX tools.`
  );
}

function loadWorkbook() {
  ensureWorkbookExists();
  return XLSX.readFile(DATA_PATH, {
    cellFormula: true,
    cellDates: true,
    cellNF: true,
  });
}

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

export function getRange(
  range: string,
  sheetName?: string
): RangeResult {
  // Decode the A1 range and return a rectangular grid of values.
  const workbook = loadWorkbook();
  const sheet = getSheet(workbook, sheetName);
  const worksheetRange = XLSX.utils.decode_range(range);
  const values: CellValue[][] = [];

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
    delete sheet[cell];
  } else {
    const cellType =
      typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s";
    sheet[cell] = { t: cellType, v: value };
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

  XLSX.writeFile(workbook, DATA_PATH, { bookType: "xlsx" });

  return {
    sheet: sheetNameResolved,
    cell,
    previous,
    updated: value,
  };
}

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

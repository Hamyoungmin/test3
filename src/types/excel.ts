export interface ExcelFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: Date;
  sheets: SheetInfo[];
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface SheetData {
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

export interface UploadResponse {
  success: boolean;
  file?: ExcelFile;
  data?: SheetData;
  error?: string;
}

export interface ParsedExcelData {
  fileName: string;
  sheets: {
    name: string;
    data: SheetData;
  }[];
}


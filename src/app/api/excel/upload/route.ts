import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { ParsedExcelData, SheetData } from '@/types/excel';

/** 셀 값을 안전하게 파싱 (빈 값, 형식 오류 시 null 반환) */
function safeParseCellValue(v: unknown): string | number | boolean | null {
  if (v == null || v === '') return null;
  try {
    const str = String(v).trim();
    if (str === '') return null;
    const num = Number(str.replace(/,/g, ''));
    if (!isNaN(num) && str !== '') return num;
    const lower = str.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return str;
  } catch {
    return null;
  }
}

// CSV 파싱 함수 (예외 처리 강화)
function parseCSV(text: string): { headers: string[]; rows: (string | number | boolean | null)[][] } {
  let lines: string[];
  try {
    if (!text || typeof text !== 'string') return { headers: [], rows: [] };
    lines = text.split(/\r?\n/).filter(line => line != null && String(line).trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };
  } catch {
    return { headers: [], rows: [] };
  }

  const parseLine = (line: string): string[] => {
    try {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      const s = String(line);

      for (let i = 0; i < s.length; i++) {
        const char = s[i];
        if (char === '"') {
          if (inQuotes && s[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    } catch {
      return [];
    }
  };

  try {
    const firstLine = lines[0];
    const headers = parseLine(firstLine ?? '').map((h, i) => (h != null && String(h).trim() !== '') ? String(h).trim() : `Column_${i + 1}`);
    const rows: (string | number | boolean | null)[][] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseLine(lines[i] ?? '');
        rows.push(values.map(v => safeParseCellValue(v)));
      } catch {
        rows.push([]);
      }
    }

    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    // 파일 확장자 검증
    const fileName = file.name.toLowerCase();
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const isValidFile = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isValidFile) {
      return NextResponse.json(
        { success: false, error: '엑셀 파일(.xlsx, .xls, .csv)만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    const originalFileName = file.name;
    const parsedData: ParsedExcelData = {
      fileName: originalFileName,
      sheets: [],
    };

    // CSV 파일 처리
    if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);

      const sheetData: SheetData = {
        headers: Array.isArray(headers) ? headers : [],
        rows: Array.isArray(rows) ? rows : [],
      };

      parsedData.sheets.push({
        name: 'Sheet1',
        data: sheetData,
      });
    } else {
      // Excel 파일 처리 (.xlsx, .xls)
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const workbook = new ExcelJS.Workbook();
      // @ts-expect-error - ExcelJS 타입이 Node.js 22+ Buffer 제네릭을 지원하지 않음
      await workbook.xlsx.load(buffer);

      // 각 시트 처리 (예외 처리 강화)
      workbook.eachSheet((worksheet) => {
        try {
          const sheetData: SheetData = {
            headers: [],
            rows: [],
          };

          let isFirstRow = true;

          worksheet.eachRow((row, rowNumber) => {
            try {
              const rowValues: (string | number | boolean | null)[] = [];

              row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                try {
                  let cellValue: string | number | boolean | null = null;

                  if (cell?.value != null && cell.value !== undefined) {
                    const val = cell.value;
                    if (typeof val === 'object') {
                      if (val instanceof Date) {
                        cellValue = val.toLocaleDateString('ko-KR');
                      } else if (val && typeof val === 'object' && 'result' in val) {
                        cellValue = safeParseCellValue((val as { result: unknown }).result);
                      } else if (val && typeof val === 'object' && 'text' in val) {
                        cellValue = String((val as { text: unknown }).text ?? '');
                      } else {
                        cellValue = safeParseCellValue(val);
                      }
                    } else {
                      cellValue = safeParseCellValue(val);
                    }
                  }
                  rowValues.push(cellValue ?? null);
                } catch {
                  rowValues.push(null);
                }
              });

              if (isFirstRow) {
                sheetData.headers = rowValues.map((v, i) =>
                  v != null && String(v).trim() !== '' ? String(v).trim() : `Column_${i + 1}`
                );
                isFirstRow = false;
              } else {
                sheetData.rows.push(rowValues);
              }
            } catch {
              /* 해당 행 스킵 */
            }
          });

          parsedData.sheets.push({
            name: String(worksheet.name || 'Sheet1'),
            data: sheetData,
          });
        } catch {
          /* 해당 시트 스킵 */
        }
      });
    }

    const totalRowCount = parsedData.sheets.reduce((sum, s) => sum + (s.data?.rows?.length ?? 0), 0);

    return NextResponse.json({
      success: true,
      data: parsedData,
      totalRowCount,
      file: {
        id: crypto.randomUUID(),
        name: originalFileName,
        size: file.size,
        uploadedAt: new Date(),
        sheets: parsedData.sheets.map((sheet) => ({
          name: sheet.name,
          rowCount: sheet.data?.rows?.length ?? 0,
          columnCount: sheet.data?.headers?.length ?? 0,
        })),
      },
    });
  } catch (error) {
    console.error('Excel parsing error:', error);
    return NextResponse.json(
      { success: false, error: '파일 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { ParsedExcelData, SheetData } from '@/types/excel';

// CSV 파싱 함수
function parseCSV(text: string): { headers: string[]; rows: (string | number | boolean | null)[][] } {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // CSV 파싱 (쉼표로 분리, 따옴표 처리)
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
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
  };

  const headers = parseLine(lines[0]).map((h, i) => h || `Column ${i + 1}`);
  const rows = lines.slice(1).map(line => {
    const values = parseLine(line);
    return values.map(v => {
      if (v === '') return null;
      const num = Number(v);
      if (!isNaN(num) && v !== '') return num;
      if (v.toLowerCase() === 'true') return true;
      if (v.toLowerCase() === 'false') return false;
      return v;
    });
  });

  return { headers, rows };
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
        headers,
        rows,
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

      // 각 시트 처리
      workbook.eachSheet((worksheet) => {
        const sheetData: SheetData = {
          headers: [],
          rows: [],
        };

        let isFirstRow = true;
        
        worksheet.eachRow((row, rowNumber) => {
          const rowValues: (string | number | boolean | null)[] = [];
          
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            let cellValue: string | number | boolean | null = null;
            
            if (cell.value !== null && cell.value !== undefined) {
              if (typeof cell.value === 'object') {
                // 날짜나 다른 객체 타입 처리
                if (cell.value instanceof Date) {
                  cellValue = cell.value.toLocaleDateString('ko-KR');
                } else if ('result' in cell.value) {
                  // 수식 결과
                  cellValue = String(cell.value.result);
                } else if ('text' in cell.value) {
                  // 리치 텍스트
                  cellValue = String(cell.value.text);
                } else {
                  cellValue = String(cell.value);
                }
              } else {
                cellValue = cell.value as string | number | boolean;
              }
            }
            
            rowValues.push(cellValue);
          });

          // 첫 번째 행은 헤더로 처리
          if (isFirstRow) {
            sheetData.headers = rowValues.map((v, i) => 
              v !== null ? String(v) : `Column ${i + 1}`
            );
            isFirstRow = false;
          } else {
            sheetData.rows.push(rowValues);
          }
        });

        parsedData.sheets.push({
          name: worksheet.name,
          data: sheetData,
        });
      });
    }

    return NextResponse.json({
      success: true,
      data: parsedData,
      file: {
        id: crypto.randomUUID(),
        name: originalFileName,
        size: file.size,
        uploadedAt: new Date(),
        sheets: parsedData.sheets.map((sheet) => ({
          name: sheet.name,
          rowCount: sheet.data.rows.length,
          columnCount: sheet.data.headers.length,
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


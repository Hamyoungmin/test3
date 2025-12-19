import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { ParsedExcelData, SheetData } from '@/types/excel';

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
    const fileName = file.name;
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { success: false, error: '엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    // 파일을 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ExcelJS로 파일 읽기
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const parsedData: ParsedExcelData = {
      fileName: fileName,
      sheets: [],
    };

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

    return NextResponse.json({
      success: true,
      data: parsedData,
      file: {
        id: crypto.randomUUID(),
        name: fileName,
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


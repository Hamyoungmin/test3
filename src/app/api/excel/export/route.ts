import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

type CellValue = string | number | boolean | null | undefined;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { headers, rows, fileName = 'export', includeEmptyRows = true } = body;

    if (!headers || !rows) {
      return NextResponse.json(
        { success: false, error: '데이터가 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    // 새 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');

    // 컬럼 정의 (구조 유지를 위해 명시적으로 설정)
    worksheet.columns = headers.map((header: string, index: number) => ({
      header,
      key: `col_${index}`,
      width: 15,
    }));

    // 헤더 스타일링
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6366F1' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.commit();

    // 데이터 행 추가 (빈 행 구조 유지)
    rows.forEach((row: CellValue[]) => {
      // 각 행의 모든 컬럼에 대해 값 설정 (빈 값도 명시적으로 처리)
      const normalizedRow = headers.map((_: string, index: number) => {
        const value = row[index];
        // null, undefined는 빈 문자열로 변환하여 셀 구조 유지
        if (value === null || value === undefined) {
          return '';
        }
        return value;
      });

      const addedRow = worksheet.addRow(normalizedRow);
      
      // 빈 행이라도 셀 스타일 적용하여 구조 유지
      addedRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
      addedRow.commit();
    });

    // 빈 행 추가 옵션 (기본 5개의 빈 행 추가로 구조 확장성 제공)
    if (includeEmptyRows) {
      const emptyRowCount = 5;
      for (let i = 0; i < emptyRowCount; i++) {
        const emptyRow = headers.map(() => '');
        const addedRow = worksheet.addRow(emptyRow);
        addedRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
        });
        addedRow.commit();
      }
    }

    // 컬럼 너비 자동 조절
    worksheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? String(cell.value).length : 0;
        if (cellLength > maxLength) {
          maxLength = Math.min(cellLength, 50);
        }
      });
      column.width = Math.max(maxLength + 2, 12);
    });

    // 첫 행(헤더) 고정
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Buffer로 변환
    const buffer = await workbook.xlsx.writeBuffer();

    // 응답 반환
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Excel export error:', error);
    return NextResponse.json(
      { success: false, error: '파일 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { headers, rows, fileName = 'export' } = body;

    if (!headers || !rows) {
      return NextResponse.json(
        { success: false, error: '데이터가 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    // 새 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');

    // 헤더 추가
    worksheet.addRow(headers);

    // 헤더 스타일링
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6366F1' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // 데이터 행 추가
    rows.forEach((row: (string | number | boolean | null)[]) => {
      worksheet.addRow(row);
    });

    // 컬럼 너비 자동 조절
    worksheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? String(cell.value).length : 0;
        if (cellLength > maxLength) {
          maxLength = Math.min(cellLength, 50);
        }
      });
      column.width = maxLength + 2;
    });

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


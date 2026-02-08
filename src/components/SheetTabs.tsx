'use client';

interface SheetTabsProps {
  sheets: string[];
  activeSheet: string;
  onSelect: (sheet: string) => void;
}

export default function SheetTabs({ sheets, activeSheet, onSelect }: SheetTabsProps) {
  if (sheets.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {sheets.map((sheet) => (
        <button
          key={sheet}
          onClick={() => onSelect(sheet)}
          className={`
            px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200
            ${
              activeSheet === sheet
                ? 'bg-green-700 text-white shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }
          `}
        >
          {sheet}
        </button>
      ))}
    </div>
  );
}


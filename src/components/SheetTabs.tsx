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
                ? 'bg-green-700 dark:bg-green-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
            }
          `}
        >
          {sheet}
        </button>
      ))}
    </div>
  );
}


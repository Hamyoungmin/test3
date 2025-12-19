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
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }
          `}
        >
          {sheet}
        </button>
      ))}
    </div>
  );
}


"use client";

interface DateRangePickerProps {
  label: string;
  dateFrom: string;
  dateTo: string;
  onChangeFrom: (date: string) => void;
  onChangeTo: (date: string) => void;
}

export function DateRangePicker({
  label,
  dateFrom,
  dateTo,
  onChangeFrom,
  onChangeTo,
}: DateRangePickerProps) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-400">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onChangeFrom(e.target.value)}
          className="w-[120px] rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none hover:border-zinc-500"
        />
        <span className="text-xs text-zinc-500">–</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onChangeTo(e.target.value)}
          className="w-[120px] rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none hover:border-zinc-500"
        />
      </div>
    </div>
  );
}

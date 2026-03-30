'use client';

/* Assignment: Add at least three more modes (e.g. redOnly, greenOnly, 2xG-R-B) in type and OPTIONS (Additional Work 3). */
export type SignalCombinationMode = 'default' | 'redOnly' | 'greenOnly' | '2xG-R-B' | 'blueOnly';

const SIGNAL_COMBINATION_OPTIONS: {
  value: SignalCombinationMode;
  label: string;
}[] = [
  { value: 'default', label: 'Default (2R−G−B)' },
  { value: 'redOnly', label: 'Red only (R)' },
  { value: 'greenOnly', label: 'Green only (G)' },
  { value: '2xG-R-B', label: '2×Green−Red−Blue (2G−R−B)' },
  { value: 'blueOnly', label: 'Blue only (B)' },
];

interface SignalCombinationSelectorProps {
  value: SignalCombinationMode;
  onChange: (value: SignalCombinationMode) => void;
}

export default function SignalCombinationSelector({
  value,
  onChange,
}: SignalCombinationSelectorProps) {
  return (
    <div className="mt-2">
      <label
        htmlFor="signal-combination"
        className="block text-sm font-medium text-gray-700"
      >
        Signal combination
      </label>
      <select
        id="signal-combination"
        value={value}
        onChange={(e) => onChange(e.target.value as SignalCombinationMode)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
      >
        {SIGNAL_COMBINATION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

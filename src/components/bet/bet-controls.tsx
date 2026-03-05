import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BetControlsProps {
  value: string;
  onValueChange: (next: string) => void;
  min: number;
  max: number;
  step?: number;
  quickBets?: number[];
  label?: string;
  disabled?: boolean;
  currency?: string;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function decimalsForStep(step: number): number {
  const raw = String(step);
  const fraction = raw.split(".")[1];
  return fraction ? fraction.length : 0;
}

function formatStake(value: number, step: number): string {
  const rounded = Number(value.toFixed(decimalsForStep(step)));
  return String(rounded);
}

export function BetControls({
  value,
  onValueChange,
  min,
  max,
  step = 0.1,
  quickBets = [1, 5, 10, 15, 20],
  label = "Stake",
  disabled = false,
  currency,
  className,
}: BetControlsProps) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? clamp(parsed, min, max) : min;
  const validQuickBets = quickBets.filter((bet) => bet >= min && bet <= max);

  return (
    <div className={cn("bet-controls", className)}>
      <div className="bet-controls-head">
        <p>{label}</p>
        <p className="bet-controls-value">
          {currency ? `${currency} ` : ""}
          {safeValue.toFixed(Math.max(2, decimalsForStep(step)))}
        </p>
      </div>

      <div className="bet-controls-chips">
        {validQuickBets.map((bet) => {
          const selected = Math.abs(safeValue - bet) < step / 2;
          return (
            <Button
              key={bet}
              type="button"
              size="sm"
              variant={selected ? "default" : "secondary"}
              disabled={disabled}
              onClick={() => onValueChange(formatStake(clamp(bet, min, max), step))}
            >
              {bet}
            </Button>
          );
        })}
      </div>

      <input
        className="bet-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        disabled={disabled}
        onChange={(event) => onValueChange(formatStake(Number(event.target.value), step))}
      />

      <div className="bet-controls-footer">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <p>
          min {min} / max {max}
        </p>
      </div>
    </div>
  );
}

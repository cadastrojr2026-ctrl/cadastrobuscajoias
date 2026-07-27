type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export function NecklaceIcon({ size = 24, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 5C4 13 8 17 12 17C16 17 20 13 20 5" />
      <path d="M12 17V20" />
      <circle cx="12" cy="21" r="2" />
    </svg>
  );
}

export function PendantIcon({ size = 24, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3V9" />
      <path d="M9 12L12 16L15 12L12 8L9 12Z" />
      <path d="M9 12H15" />
    </svg>
  );
}

export function BraceletIcon({ size = 24, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 10C5 15 8 18 12 18C16 18 19 15 19 10C19 6 16 4 12 4C8 4 5 6 5 10Z" />
      <path d="M5 10C5 13 8 15 12 15C16 15 19 13 19 10" />
    </svg>
  );
}

/**
 * ArthSathi — Loader Component
 *
 * Loading spinner with sizes, colors, optional text
 */

'use client';

export type LoaderSize = 'sm' | 'md' | 'lg' | 'xl';
export type LoaderColor = 'primary' | 'secondary' | 'accent' | 'white';

export interface LoaderProps {
  size?: LoaderSize;
  color?: LoaderColor;
  text?: string;
  fullScreen?: boolean;
}

export default function Loader({
  size = 'md',
  color = 'primary',
  text,
  fullScreen = false,
}: LoaderProps) {
  const sizeClasses: Record<LoaderSize, string> = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };

  const colorClasses: Record<LoaderColor, string> = {
    primary: 'text-primary',
    secondary: 'text-secondary',
    accent: 'text-accent',
    white: 'text-white',
  };

  const spinner = (
    <div className="flex flex-col items-center justify-center gap-4">
      <svg
        className={`animate-spin ${sizeClasses[size]} ${colorClasses[color]}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {text && (
        <p className={`text-lg font-medium ${colorClasses[color]}`} role="status">
          {text}
        </p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
        {spinner}
      </div>
    );
  }

  return spinner;
}

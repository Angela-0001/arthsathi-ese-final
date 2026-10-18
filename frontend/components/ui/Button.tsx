/**
 * ArthSathi — Button Component
 *
 * Reusable accessible button with variants, sizes, loading states
 */

'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = true,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  // Base classes (WCAG touch target compliance)
  const baseClasses = 'inline-flex items-center justify-center gap-3 font-semibold rounded-2xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed';

  // Variant styles
  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-white active:bg-primary-dark focus-visible:ring-accent',
    secondary: 'bg-secondary text-white active:bg-secondary-dark focus-visible:ring-accent',
    accent: 'bg-accent text-white active:bg-accent-dark focus-visible:ring-primary',
    ghost: 'bg-transparent text-primary border-2 border-primary active:bg-primary/10 focus-visible:ring-accent',
  };

  // Size styles
  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'py-2 px-4 text-lg min-h-[48px]',
    md: 'py-3 px-5 text-xl min-h-[56px]',
    lg: 'py-4 px-6 text-2xl min-h-[64px]',
  };

  // Width
  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-5 w-5"
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
      )}
      {!loading && icon && <span className="text-2xl">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

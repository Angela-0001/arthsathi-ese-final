/**
 * ArthSathi — Card Component
 *
 * Container card with shadow, border, hover effects
 * Used for scheme/insurance cards, feature highlights, info boxes
 */

'use client';

import { HTMLAttributes, ReactNode } from 'react';

export type CardShadow = 'none' | 'sm' | 'md' | 'lg';
export type CardPadding = 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  shadow?: CardShadow;
  border?: boolean;
  padding?: CardPadding;
  hoverable?: boolean;
  children: ReactNode;
}

export default function Card({
  shadow = 'md',
  border = true,
  padding = 'md',
  hoverable = false,
  className = '',
  children,
  ...props
}: CardProps) {
  const shadowClasses: Record<CardShadow, string> = {
    none: '',
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
  };

  const paddingClasses: Record<CardPadding, string> = {
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };

  const borderClass = border ? 'border border-gray-200' : '';
  const hoverClass = hoverable ? 'hover:shadow-xl hover:border-primary transition-all cursor-pointer' : '';

  return (
    <div
      className={`bg-white rounded-3xl ${shadowClasses[shadow]} ${borderClass} ${paddingClasses[padding]} ${hoverClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

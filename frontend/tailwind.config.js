/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ArthSathi brand colours — green theme, accessible, high-contrast
      colors: {
        primary: {
          DEFAULT: '#16A34A',  // green-600 (growth, trust, prosperity)
          light:   '#22C55E',
          dark:    '#15803D',
        },
        secondary: {
          DEFAULT: '#059669',  // emerald-600 (harmony, nature)
          light:   '#10B981',
          dark:    '#047857',
        },
        accent: {
          DEFAULT: '#0EA5E9',  // sky blue (clarity, accessibility)
          light:   '#38BDF8',
          dark:    '#0284C7',
        },
        surface: {
          DEFAULT: '#FAFAFA',  // off-white (clean, calm)
          alt:     '#F5F5F5',
        },
        textDark: {
          DEFAULT: '#1F2937',
          light:   '#374151',
        },
        danger: '#DC2626',
        warning: '#F59E0B',
        success: '#16A34A',
      },
      // Minimum 48px touch targets everywhere (WCAG 2.5.5)
      minHeight: {
        touch: '48px',
      },
      minWidth: {
        touch: '48px',
      },
      fontSize: {
        // Larger base font for low-literacy users on small screens
        'base': ['18px', '1.6'],
        'lg':   ['20px', '1.6'],
        'xl':   ['22px', '1.6'],
        '2xl':  ['26px', '1.4'],
        '3xl':  ['30px', '1.3'],
      },
      fontFamily: {
        sans: ['Noto Sans', 'system-ui', 'sans-serif'],
        // Noto Sans covers all 6 ArthSathi languages in one font family
      },
    },
  },
  plugins: [],
};

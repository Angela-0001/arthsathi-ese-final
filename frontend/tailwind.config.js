/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ArthSathi brand colours — earthy, accessible, high-contrast
      colors: {
        primary: {
          DEFAULT: '#1B6B3A',  // deep green (trust, growth)
          light:   '#2E8B57',
          dark:    '#0D4F2A',
        },
        accent: {
          DEFAULT: '#F5A623',  // warm amber (energy, harvest)
          light:   '#FBBF24',
          dark:    '#D97706',
        },
        surface: {
          DEFAULT: '#FEFEFE',
          alt:     '#F0F4F0',
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

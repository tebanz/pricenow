/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#1549A8',
          600: '#1240A0',
          700: '#0e3490',
        },
        success: {
          50:  '#f0fdf4',
          500: '#10B981',
          600: '#059669',
        },
        warning: {
          50:  '#fffbeb',
          500: '#F59E0B',
          600: '#D97706',
        },
        danger: {
          50:  '#fef2f2',
          500: '#EF4444',
          600: '#DC2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

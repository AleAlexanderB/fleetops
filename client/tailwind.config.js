/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1E4FAB',
          dark:    '#153a82',
          light:   '#2d63d4',
        },
      },
    },
  },
  plugins: [],
}

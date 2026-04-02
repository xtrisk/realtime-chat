export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        chat: {
          sent: '#3B82F6',
          received: '#E5E7EB',
          background: '#F8FAFC',
          darkBg: '#1F2937',
          darkSent: '#2563EB',
          darkReceived: '#374151',
        },
      },
    },
  },
  plugins: [],
};
/** Tailwind theme recovered from MiniHUB 0.24.4's compiled stylesheet (assets/index-6fd3c6fa.css). */
module.exports = {
  content: {
    // builds run from the repo root — resolve globs relative to this file
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  theme: {
    screens: {
      sm: '390px',
      md: '768px',
      lg: '976px',
      xl: '1440px',
    },
    extend: {
      colors: {
        contrast1: '#17191C',
        contrast2: '#282B2E',
        contrast4: '#52535B',
        statusBlue: '#4FDAE3',
        grey80: '#A7A7B0',
      },
      backgroundImage: {
        minima: "url('/assets/wallpapers/minima.jpg')",
        feather: "url('/assets/wallpapers/feather.jpg')",
        liquid: "url('/assets/wallpapers/liquid.jpg')",
        'thumbnail-minima': "url('/assets/thumbnails/minima.png')",
        'thumbnail-feather': "url('/assets/thumbnails/feather.png')",
        'thumbnail-liquid': "url('/assets/thumbnails/liquid.png')",
        'thumbnail-desert': "url('/assets/thumbnails/desert.png')",
        'thumbnail-galaxy': "url('/assets/thumbnails/galaxy.png')",
        'thumbnail-mountains': "url('/assets/thumbnails/mountains.png')",
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
      },
      animation: {
        fadeIn: 'fadeIn .5s',
      },
    },
  },
  // the hub builds `bg-${option}` class names at runtime (wallpaper picker / folder previews)
  safelist: [
    { pattern: /^bg-(minima|feather|liquid|none|custom)$/ },
    { pattern: /^bg-thumbnail-(minima|feather|liquid|desert|galaxy|mountains)$/ },
  ],
  plugins: [],
};

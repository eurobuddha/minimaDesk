const path = require('node:path');

// Builds run from the repo root; point Tailwind at this directory's config explicitly.
module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};

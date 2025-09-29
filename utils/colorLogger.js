// utils/colorLogger.js
const COLORS = {
  reset: "\x1b[0m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

/**
 * Colorize text for console.log
 * @param {string} text - The text to colorize
 * @param {string} color - The color name (e.g., "red", "green", "yellow")
 * @returns {string}
 */
function colorize(text, color = "reset") {
  const colorCode = COLORS[color] || COLORS.reset;
  return `${colorCode}${text}${COLORS.reset}`;
}

module.exports = { colorize };

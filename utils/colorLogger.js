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

  // Light (bright) variants
  lightBlack: "\x1b[90m",   // gray
  lightRed: "\x1b[91m",
  lightGreen: "\x1b[92m",
  lightYellow: "\x1b[93m",
  lightBlue: "\x1b[94m",
  lightMagenta: "\x1b[95m",
  lightCyan: "\x1b[96m",
  lightWhite: "\x1b[97m",

  // Background colors (optional)
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  bgLightBlack: "\x1b[100m",
  bgLightRed: "\x1b[101m",
  bgLightGreen: "\x1b[102m",
  bgLightYellow: "\x1b[103m",
  bgLightBlue: "\x1b[104m",
  bgLightMagenta: "\x1b[105m",
  bgLightCyan: "\x1b[106m",
  bgLightWhite: "\x1b[107m",
};

/**
 * Colorize text for console.log
 * @param {string} text - The text to colorize
 * @param {string} color - The color name (e.g., "red", "lightBlue", "bgYellow")
 * @returns {string}
 */
function colorize(text, color = "reset") {
  const colorCode = COLORS[color] || COLORS.reset;
  return `${colorCode}${text}${COLORS.reset}`;
}

module.exports = { colorize, COLORS };

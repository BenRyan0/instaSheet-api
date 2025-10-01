// utils/regex.js
const PHONE_REGEX =
  /(\+?\d{1,3}[-.\s]?)?(\(\d{2,4}\)|\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;

export function extractPhoneFromText(text = "") {
  const match = text.match(PHONE_REGEX);
  return match ? match[0] : "";
}


export const DOUBLE_NEWLINE_REGEX = /\r?\n\r?\n/;

export function splitOnParagraphs(text = "") {
  return text.split(DOUBLE_NEWLINE_REGEX);
}
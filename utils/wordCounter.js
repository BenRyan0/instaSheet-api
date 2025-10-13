export async function countWords(text) {
  if (!text || typeof text !== "string") return 0;

  // Remove quoted email chains and replies (lines starting with ">")
  const cleanedText = text
    .split("\n")
    .filter(line => !line.trim().startsWith(">")) // skip quoted email content
    .join(" ");

  // Remove email addresses, URLs, and special characters
  const strippedText = cleanedText
    .replace(/https?:\/\/\S+/g, "") // remove URLs
    .replace(/\S+@\S+\.\S+/g, "")   // remove email addresses
    .replace(/[^a-zA-Z0-9\s']/g, "") // remove non-word characters (keep apostrophes)
    .trim();

  // Split by whitespace and count
  const words = strippedText.split(/\s+/).filter(Boolean);
  return words.length;
}
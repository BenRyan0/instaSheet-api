// utils/leads.js
export function normalizeLeadsArray(resp) {
  console.log("normalizeLeadsArray")
  return (
    resp?.items ||
    resp?.data?.items ||
    resp?.data ||
    resp?.results ||
    resp ||
    []
  );
}

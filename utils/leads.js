// utils/leads.js
export function normalizeLeadsArray(resp) {
  return (
    resp?.items ||
    resp?.data?.items ||
    resp?.data ||
    resp?.results ||
    resp ||
    []
  );
}

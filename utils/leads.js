// utils/leads.js
export function normalizeLeadsArray(resp) {
  console.log("normalizeLeadsArray")
  console.log( resp?.items ||
    resp?.data?.items ||
    resp?.data ||
    resp?.results ||
    resp ||
    [])
  return (
    resp?.items ||
    resp?.data?.items ||
    resp?.data ||
    resp?.results ||
    resp ||
    []
  );
}

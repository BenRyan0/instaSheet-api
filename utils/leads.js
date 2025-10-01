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


// utils/leads.js
export function getNextCursor(resp) {
  return (
    resp?.next_starting_after ||
    resp?.data?.next_starting_after ||
    resp?.paging?.next_cursor ||
    resp?.pagination?.next_starting_after ||
    null
  );
}

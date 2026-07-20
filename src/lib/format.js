// Human-facing order code. Prefers the sequential `order_number` column from
// the database; falls back to a short slice of the UUID when it's missing.
// Rendered as a clean UPPERCASE alphanumeric run with separators stripped,
// e.g. order_number "BB-12/07/26-0010" -> "BB1207260010". Search filters
// lowercase both sides before comparing, so uppercasing here is safe.
export function orderCode(order) {
  if (order && order.order_number != null && order.order_number !== '') {
    return String(order.order_number).replace(/[^a-z0-9]/gi, '').toUpperCase()
  }
  const id = order?.id
  return id ? String(id).replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() : 'New order'
}

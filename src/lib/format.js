// Human-facing order code. Prefers the sequential `order_number` column from
// the database; falls back to a short slice of the UUID when it's missing.
export function orderCode(order) {
  if (order && order.order_number != null && order.order_number !== '') {
    return `ORD-${order.order_number}`
  }
  const id = order?.id
  return id ? `ORD-${String(id).slice(0, 4).toUpperCase()}` : 'New order'
}

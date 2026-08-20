/* ── Coupons / offers ─────────────────────────────────────────────────────
 * The customer app owns the real logic (its src/lib/coupons.ts): which offer a
 * cart qualifies for, which the customer has already burnt, and what comes off
 * the bill. The dashboard only *writes* the rows, so this file carries just the
 * parts that must agree with the app or the admin will be lied to:
 *
 *   · the shape rules — a row is either flat or percentage, never both, which
 *     is what the `coupons_shape_check` constraint enforces in the database,
 *   · the discount maths, so the form can preview what a cart actually saves,
 *   · the human summary a row reads as.
 *
 * Everything here is pure — no Supabase, no React — so it stays easy to keep
 * in step with the app's copy. Ordering, eligibility and redemption tracking
 * are deliberately NOT duplicated here.
 */

/** Percentage offers carry `discount_percent`; flat ones leave it null. */
export function isPercentCoupon(coupon) {
  return coupon?.discount_percent != null && Number(coupon.discount_percent) > 0
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

/**
 * What the offer does, straight from the numbers — "10% off up to ₹100",
 * "₹50 off". Always generated, so the list shows the real mechanics even when
 * the admin has written banner text over it.
 */
export function offerSummary(coupon) {
  if (!coupon) return '—'
  if (isPercentCoupon(coupon)) {
    const cap = Number(coupon.max_discount) || 0
    const pct = Number(coupon.discount_percent)
    return cap > 0 ? `${pct}% off up to ${rupees(cap)}` : `${pct}% off`
  }
  return `${rupees(coupon.discount_amount)} off`
}

/**
 * What the customer reads on the coupon sheet: the admin's banner text when
 * there is one, otherwise the generated summary. Mirrors the app's
 * `couponLabel()`.
 */
export function couponLabel(coupon) {
  const description = coupon?.description?.trim()
  return description || offerSummary(coupon)
}

/**
 * Rupees off a given food subtotal. Percentage offers are floored, then capped
 * at `max_discount`; no offer ever exceeds the subtotal itself. The delivery
 * fee is not part of `subtotal` and is never discounted.
 */
export function couponDiscount(coupon, subtotal) {
  const sub = Math.max(0, Number(subtotal) || 0)
  if (!coupon || sub <= 0) return 0
  let off
  if (isPercentCoupon(coupon)) {
    off = Math.floor((sub * Number(coupon.discount_percent)) / 100)
    const cap = Number(coupon.max_discount) || 0
    if (cap > 0) off = Math.min(off, cap)
  } else {
    off = Number(coupon.discount_amount) || 0
  }
  return Math.max(0, Math.min(Math.floor(off), sub))
}

/* ── Who may use an offer ───────────────────────────────────────────────────
 * Two independent booleans in the database, but only three combinations make
 * sense to an admin, so the form offers them as one choice. */
export const USAGE_RULES = [
  {
    id: 'anyone',
    label: 'Everyone, every order',
    short: 'Unlimited',
    hint: 'No limit — the same customer can use it on every order they place.',
  },
  {
    id: 'first_order',
    label: 'New customers only',
    short: 'First order only',
    hint: 'Only on a customer’s very first order, ever.',
  },
  {
    id: 'once',
    label: 'Once per customer',
    short: 'Once each',
    hint: 'Each customer may redeem this code exactly once.',
  },
]

export const USAGE_RULE_BY_ID = Object.fromEntries(USAGE_RULES.map((r) => [r.id, r]))

/** Which of the three a stored row reads as. `first_order_only` already implies
 * "once", so it wins when a hand-written row has set both. */
export function usageRuleOf(coupon) {
  if (coupon?.first_order_only) return 'first_order'
  if (coupon?.once_per_customer) return 'once'
  return 'anyone'
}

/** The two columns a rule id writes. */
export function usageRuleFlags(id) {
  return {
    first_order_only: id === 'first_order',
    once_per_customer: id === 'once',
  }
}

/** Codes are stored upper-case and alphanumeric — that's what customers type. */
export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The blank form the Add dialog opens on. */
export const EMPTY_COUPON_FORM = {
  code: '',
  type: 'flat', // 'flat' | 'percent'
  discount_amount: '',
  discount_percent: '',
  max_discount: '',
  min_order_value: '',
  sort_order: '',
  rule: 'anyone',
  description: '',
  is_active: true,
}

/** Load an existing row into the form. */
export function couponToForm(coupon) {
  const percent = isPercentCoupon(coupon)
  return {
    code: coupon.code ?? '',
    type: percent ? 'percent' : 'flat',
    discount_amount: percent ? '' : String(coupon.discount_amount ?? ''),
    discount_percent: percent ? String(coupon.discount_percent ?? '') : '',
    max_discount: percent ? String(coupon.max_discount ?? '') : '',
    min_order_value: String(coupon.min_order_value ?? 0),
    sort_order: coupon.sort_order == null ? '' : String(coupon.sort_order),
    rule: usageRuleOf(coupon),
    description: coupon.description ?? '',
    is_active: coupon.is_active ?? true,
  }
}

/**
 * Turn the form into a database row, or explain why it can't be one.
 *
 * The checks here are the same ones `coupons_shape_check` makes — catching them
 * in the form means the admin gets "Set a cap for a percentage offer" instead
 * of a raw constraint violation.
 *
 * @returns {{ row: object } | { error: string }}
 */
export function couponRowFromForm(form) {
  const code = normalizeCode(form.code)
  if (!code) return { error: 'Enter a coupon code, e.g. WELCOME10.' }

  const row = {
    code,
    min_order_value: Math.max(0, Math.round(Number(form.min_order_value) || 0)),
    description: form.description?.trim() ? form.description.trim() : null,
    is_active: !!form.is_active,
    ...usageRuleFlags(form.rule),
  }

  if (form.type === 'percent') {
    const percent = Number(form.discount_percent)
    const cap = Number(form.max_discount)
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      return { error: 'Percentage must be between 1 and 100.' }
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      return { error: 'A percentage offer needs a maximum ₹ off, so one huge order can’t empty the till.' }
    }
    // Flat and percentage are mutually exclusive: the app reads
    // discount_percent first, and the constraint rejects a row carrying both.
    row.discount_amount = 0
    row.discount_percent = Math.round(percent)
    row.max_discount = Math.round(cap)
  } else {
    const amount = Number(form.discount_amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Enter how many rupees come off, e.g. 50.' }
    }
    row.discount_amount = Math.round(amount)
    row.discount_percent = null
    row.max_discount = null
  }

  const sort = Number(form.sort_order)
  if (form.sort_order !== '' && (!Number.isFinite(sort) || sort < 0)) {
    return { error: 'List position must be 0 or higher.' }
  }
  if (form.sort_order !== '') row.sort_order = Math.round(sort)

  return { row }
}

/** Turn a Postgres error from a coupon write into something an admin can act on. */
export function couponErrorMessage(error) {
  if (!error) return ''
  if (error.code === '23505') return 'That code already exists. Pick a different one.'
  if (error.code === '23514') {
    return 'The database rejected that offer: it must be either a flat ₹ amount or a percentage with a cap, not a mix.'
  }
  if (error.code === '42P01') return MISSING_TABLE_HINT
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'This login isn’t allowed to change offers. Ask the owner, or run add-coupons.sql.'
  }
  return error.message || 'Something went wrong.'
}

export const MISSING_TABLE_HINT =
  'Offers need the coupons table — run add-coupons.sql once in the Supabase SQL editor.'

/** Was this failure "the migration hasn't been run yet"? */
export function isMissingCouponsTable(error) {
  return error?.code === '42P01' || /relation .*coupons.* does not exist/i.test(error?.message || '')
}

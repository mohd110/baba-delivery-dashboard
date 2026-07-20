import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  ChefHat,
  CheckCircle2,
  ShieldCheck,
  Truck,
  Hash,
  MapPin,
  Bike,
  Phone,
  Wallet,
  Ban,
  ExternalLink,
  Printer,
  Search,
  Check,
  Clock,
  X,
  PackageX,
  Hourglass,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'
import { OrderIdLabel } from '../components/OrderIdLabel.jsx'
import { useRestaurant, isAutoScheduleOn } from '../lib/restaurant.js'

function imgFor(name = '', photoUrl) {
  if (photoUrl) return photoUrl
  const n = name.toLowerCase()
  if (n.includes('mutton') || n.includes('korma')) return '/assets/mutton-korma.png'
  if (n.includes('paneer')) return '/assets/paneer-tikka.png'
  if (n.includes('butter')) return '/assets/butter-chicken.png'
  if (n.includes('tikka') || n.includes('aatishi')) return '/assets/chicken-aatishi.png'
  if (n.includes('kebab') || n.includes('galouti')) return '/assets/galouti-kebab.png'
  return '/assets/chicken-biryani.png'
}

function elapsed(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  return `${Math.floor(hr / 24)}d`
}

// Prep countdown target: the moment the order is due to be ready. Uses the same
// inputs the customer app reads (placed-at + eta_minutes), so the dashboard
// countdown and the customer's ETA always agree. Null when no ETA is set.
function readyByTs(order) {
  if (!order || !(order.eta_minutes > 0)) return null
  return new Date(order.created_at).getTime() + order.eta_minutes * 60000
}

// Format a signed remaining-time as M:SS, prefixing "+" once the timer is over.
function fmtCountdown(ms) {
  const over = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${over ? '+' : ''}${m}:${String(s).padStart(2, '0')}`
}

// Minutes added to eta_minutes when the manager snoozes an expired prep timer.
const SNOOZE_MIN = 5
// How long the card blinks and the buzzer sounds after a timer runs out.
const ALARM_MS = 60000

// --- Prep-timer buzzer (Web Audio, no asset) -------------------------------
// A short repeating square-wave beep that runs while any prep timer is expired.
let _audioCtx = null
let _buzzTimer = null
function startBuzzer() {
  if (_buzzTimer) return
  const beep = () => {
    try {
      if (!_audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return
        _audioCtx = new Ctx()
      }
      const ctx = _audioCtx
      if (ctx.state === 'suspended') ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.34)
    } catch {
      /* audio unavailable — silently ignore */
    }
  }
  beep()
  _buzzTimer = setInterval(beep, 800)
}
function stopBuzzer() {
  if (_buzzTimer) {
    clearInterval(_buzzTimer)
    _buzzTimer = null
  }
}

// Veg / non-veg detection. No dedicated column exists, so infer from the dish
// name the same way the app infers category and image. Veg keywords win over
// non-veg ones (e.g. "Paneer Tikka" is veg despite "tikka").
const VEG_RE = /paneer|veg\b|veggie|aloo|dal|daal|chana|chole|rajma|gobi|mushroom|palak|bhindi|jeera|soya|tofu|salad|raita|corn|mutter|matar|kaju/i
const NONVEG_RE = /chicken|mutton|lamb|beef|fish|prawn|shrimp|egg|meat|keema|kheema|qeema|kebab|kabab|galouti|seekh|tikka|tangdi|tandoori|korma|qorma|murgh|gosht|biryani|nihari|haleem|butter chicken|masala chicken/i
function isVegItem(name = '') {
  const n = String(name).toLowerCase()
  if (VEG_RE.test(n)) return true
  if (NONVEG_RE.test(n)) return false
  return false // menu is non-veg-forward; treat unknowns as non-veg
}

// The classic FSSAI food symbol: a bordered square with a centered dot,
// green for veg and red for non-veg.
function VegMark({ veg, className = '' }) {
  const color = veg ? '#16a34a' : '#dc2626'
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] ${className}`}
      style={{ borderColor: color }}
      title={veg ? 'Veg' : 'Non-veg'}
      aria-label={veg ? 'Veg' : 'Non-veg'}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

// Line total for a single order item (unit price × quantity).
function lineTotal(it) {
  return (it.price_at_order ?? 0) * (it.quantity ?? 1)
}

// A pending order with unavailable_items set is waiting on the customer to
// accept the revised order or cancel it — the restaurant can't accept it yet.
function isAwaitingCustomer(order) {
  return (
    order?.status === 'pending' &&
    Array.isArray(order.unavailable_items) &&
    order.unavailable_items.length > 0
  )
}

// Fire-and-forget push notification to the customer app. Failures are
// logged but never block the order-status update they follow.
async function notifyCustomer(order, { title, body }) {
  if (!order?.customer_id) return
  try {
    const res = await fetch('https://local-delivery-app-zeta.vercel.app/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: order.customer_id,
        title,
        body,
        url: `/orders/${order.id}`,
        tag: 'order-update',
      }),
    })
    const data = await res.json()
    console.log('[Push result]', data)
  } catch (err) {
    console.error('Push notification failed:', err)
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  )
}

// Fixed outlet details printed on every ticket header.
const OUTLET = {
  name: 'WALI BABA FOODS',
  gst: 'GST NO. 09ABDPI6142H1ZR',
  address: ['GROUND FLOOR, SHOP NO 1', 'SOUTH X MALL KIDWAI NAGAR', 'KANPUR'],
  fssai: 'FSSAI Lic No. 12722045001620',
}

// Code 128 (subset B) symbol patterns, index 0–106. Each entry is the run of
// bar/space widths (bar first). Index 106 is the stop pattern (7 widths).
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

// Render `data` as an inline SVG Code 128-B barcode (no external library so it
// works inside the print iframe). Falls back to empty string on bad input.
function barcodeSvg(data, height = 46) {
  const text = String(data ?? '').replace(/[^\x20-\x7e]/g, '')
  if (!text) return ''
  const values = [104] // Start Code B
  let checksum = 104
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32
    values.push(v)
    checksum += v * (i + 1)
  }
  values.push(checksum % 103)
  values.push(106) // Stop
  let x = 10 // left quiet zone (modules)
  let isBar = true
  let rects = ''
  for (const v of values) {
    for (const ch of CODE128_PATTERNS[v]) {
      const w = Number(ch)
      if (isBar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`
      x += w
      isBar = !isBar
    }
  }
  const total = x + 10 // right quiet zone
  return `<svg class="barcode" viewBox="0 0 ${total} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
}

const money = (n) => Number(n || 0).toFixed(2)
const pad2 = (n) => String(n).padStart(2, '0')

// dd/mm/yy
function dateShort(d) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`
}
// HH:MM (24h)
function timeShort(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// Small numeric tokens derived from the order code (we have no separate
// token/bill counters in the schema, so these are stable per order).
function ticketNumbers(order) {
  const digits = orderCode(order).replace(/\D/g, '')
  return {
    token: digits.slice(-3) || digits || '0',
    bill: digits.slice(-6) || digits || '0',
  }
}

// Printed order code: uppercase throughout, with the last 4 characters bold
// and a step larger so they stand out on the thermal roll.
function orderCodeHtml(order) {
  const code = orderCode(order).toUpperCase()
  if (code.length <= 4) return `<span class="idlast">${escapeHtml(code)}</span>`
  return `${escapeHtml(code.slice(0, -4))}<span class="idlast">${escapeHtml(code.slice(-4))}</span>`
}

// Header block shared by both tickets.
function outletHead(showPaid) {
  return `
    <div class="head">
      ${showPaid ? '<div class="paid">PAID</div>' : ''}
      <div class="rname">${escapeHtml(OUTLET.name)}</div>
      <div class="reg">${escapeHtml(OUTLET.gst)}</div>
      ${OUTLET.address.map((l) => `<div class="reg">${escapeHtml(l)}</div>`).join('')}
      <div class="reg">${escapeHtml(OUTLET.fssai)}</div>
    </div>`
}

// Barcode footer shared by both tickets.
function barcodeFoot(order, caption) {
  const code = orderCode(order)
  return `
    <div class="center small">${escapeHtml(caption)}</div>
    <div class="barcodewrap">${barcodeSvg(code)}</div>
    <div class="center small">${orderCodeHtml(order)}</div>`
}

// Try to surface any customer instruction stored on the order.
function customerNote(order) {
  return (
    order.customer_notes ||
    order.notes ||
    order.special_instructions ||
    order.delivery_address?.notes ||
    ''
  )
}

// Kitchen Order Ticket — mirrors the thermal KOT layout.
function buildKotHtml(order) {
  const placed = new Date(order.created_at)
  const prepBy = new Date(placed.getTime() + (order.eta_minutes ?? 15) * 60000)
  const { token } = ticketNumbers(order)
  const items = order.order_items ?? []
  const type = (order.order_type || 'Delivery').replace(/\b\w/g, (c) => c.toUpperCase())
  const paid = order.payment_status === 'verified'
  const rows = items
    .map((it) => {
      const lineTotal = (it.price_at_order ?? 0) * (it.quantity ?? 1)
      return `
        <tr>
          <td class="name">${escapeHtml(it.products?.name || 'Item')}</td>
          <td class="note">--</td>
          <td class="qty">${it.quantity ?? 1}</td>
          <td class="amt">${money(lineTotal)}</td>
        </tr>`
    })
    .join('')
  const note = customerNote(order)
  return `
    <div class="ticket">
      ${outletHead(false)}
      <div class="kotmeta">
        <div>${dateShort(placed)} ${timeShort(placed)}</div>
        <div class="big">KOT - ${escapeHtml(token)}</div>
        <div>Order : ${orderCodeHtml(order)}</div>
        <div class="big up">${escapeHtml(type)}</div>
      </div>
      <hr />
      <div class="line"><b>Name :</b> ${escapeHtml(order.delivery_address?.name || 'Customer')}</div>
      <hr />
      <table>
        <thead>
          <tr>
            <th class="name">Item</th>
            <th class="note">Special Note</th>
            <th class="qty">Qty.</th>
            <th class="amt">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <hr />
      ${note ? `<div class="line"><b>Customer Notes:</b> ${escapeHtml(note)}</div>` : ''}
      <div class="line"><b>Payment Status :</b> ${paid ? 'Online Paid' : 'Pending'}</div>
      ${order.coupon_code ? `<div class="line"><b>Reward Type :</b> ${escapeHtml(order.coupon_code)}</div>` : ''}
      <div class="line"><b>Prepare By :</b> ${dateShort(prepBy)} ${timeShort(prepBy)}</div>
      <hr />
      ${barcodeFoot(order, 'Scan to mark food ready')}
    </div>`
}
// Customer bill — mirrors the thermal itemised bill layout.
function buildBillHtml(order) {
  const placed = new Date(order.created_at)
  const addr = order.delivery_address || {}
  const items = order.order_items ?? []
  const { token, bill } = ticketNumbers(order)
  const type = (order.order_type || 'Delivery').replace(/\b\w/g, (c) => c.toUpperCase())
  const paid = order.payment_status === 'verified'
  const subtotal = items.reduce((s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1), 0)
  const totalQty = items.reduce((s, it) => s + (it.quantity ?? 1), 0)
  const rows = items
    .map((it) => {
      const qty = it.quantity ?? 1
      const unit = it.price_at_order ?? 0
      return `
        <tr>
          <td class="name">${escapeHtml(it.products?.name || 'Item')}</td>
          <td class="qty">${qty}</td>
          <td class="price">${money(unit)}</td>
          <td class="amt">${money(unit * qty)}</td>
        </tr>`
    })
    .join('')
  const discountRow =
    order.discount_amount > 0
      ? `<div class="row"><span>Discount Fixed${
          order.coupon_code ? ` (${escapeHtml(order.coupon_code)})` : ''
        }</span><span>(${money(order.discount_amount)})</span></div>`
      : ''
  const packagingRow =
    order.delivery_fee > 0
      ? `<div class="row"><span>Packaging Charge</span><span>${money(order.delivery_fee)}</span></div>`
      : ''
  return `
    <div class="ticket">
      ${outletHead(paid)}
      <hr />
      <div class="line"><b>Order No</b> [${orderCodeHtml(order)}]</div>
      <div class="line">Name: ${escapeHtml(addr.name || 'Customer')}</div>
      ${addr.phone ? `<div class="line">Phone: ${escapeHtml(addr.phone)}</div>` : ''}
      ${addr.address ? `<div class="line small">${escapeHtml(addr.address)}</div>` : ''}
      <hr />
      <div class="row"><span>Date: ${dateShort(placed)}</span><span><b>${escapeHtml(type)}</b></span></div>
      <div class="row"><span>Cashier: biller</span><span>Bill No.: ${escapeHtml(bill)}</span></div>
      <div class="line"><b>Token No.: ${escapeHtml(token)}</b></div>
      <hr />
      <table>
        <thead>
          <tr>
            <th class="name">Item</th>
            <th class="qty">Qty.</th>
            <th class="price">Price</th>
            <th class="amt">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <hr />
      <div class="row"><span>Total Qty: ${totalQty}</span><span>Sub Total ${money(subtotal)}</span></div>
      <div class="center small">[Net Total inclusive of GST]</div>
      ${discountRow}
      ${packagingRow}
      <hr />
      <div class="grand">Grand Total ₹${money(order.total)}</div>
      <div class="small">Paid via ${paid ? 'Online' : 'Pending Payment'}</div>
      ${order.coupon_code ? `<hr /><div class="line"><b>Reward Type :</b> ${escapeHtml(order.coupon_code)}</div>` : ''}
      <hr />
      ${barcodeFoot(order, 'Scan to mark food ready')}
      <div class="center small">Thanks</div>
    </div>`
}

// Open a hidden iframe with the given ticket markup and trigger the print
// dialog, formatted for an 80mm thermal roll.
function printTickets(title, innerHtml) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #000; margin: 0; font-size: 13px; line-height: 1.35; }
          .ticket { width: 100%; page-break-after: always; }
          .ticket:last-child { page-break-after: auto; }
          hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
          .head { text-align: center; line-height: 1.3; }
          .head .paid { font-weight: bold; font-size: 13px; letter-spacing: 1px; }
          .head .rname { font-weight: bold; font-size: 16px; margin: 1px 0; }
          .head .reg { font-size: 10px; }
          .kotmeta { text-align: center; line-height: 1.35; }
          .kotmeta .big { font-weight: bold; font-size: 15px; }
          .up { text-transform: uppercase; }
          .line { font-size: 12px; padding: 1px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 2px 0; }
          th { text-align: left; font-weight: bold; border-bottom: 1px solid #000; padding: 2px 0; }
          td { padding: 2px 0; vertical-align: top; }
          th.qty, td.qty { width: 30px; text-align: center; }
          th.note, td.note { width: 60px; text-align: center; }
          th.price, td.price { width: 52px; text-align: right; white-space: nowrap; }
          th.amt, td.amt { text-align: right; white-space: nowrap; width: 58px; }
          .row { display: flex; justify-content: space-between; font-size: 12px; padding: 1px 0; }
          .grand { text-align: center; font-weight: bold; font-size: 16px; margin: 2px 0; }
          .center { text-align: center; }
          .idlast { font-weight: 800; font-size: 1.35em; }
          .small { font-size: 10px; }
          .barcodewrap { margin: 6px 0 2px; padding: 0 6px; }
          .barcode { display: block; }
        </style>
      </head>
      <body>${innerHtml}</body>
    </html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()
  // Give the iframe a tick to lay out before invoking the print dialog.
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      /* printing unavailable — ignore */
    }
    setTimeout(() => iframe.remove(), 2000)
  }, 300)
}

// Print only the kitchen KOT (food + quantity, no prices).
function printKot(order) {
  if (!order) return
  printTickets(`KOT ${orderCode(order)}`, buildKotHtml(order))
}

// Print only the customer bill (full itemised pricing).
function printBill(order) {
  if (!order) return
  printTickets(`Bill ${orderCode(order)}`, buildBillHtml(order))
}

// Map prep status to badge styles
const STATUS = {
  pending: { label: 'Pending Payment', bg: 'bg-[#fff7ed]', text: 'text-[#b45309]', border: 'border-[#ffedd5]', dot: 'bg-[#f59e0b]' },
  accepted: { label: 'Accepted', bg: 'bg-info-soft', text: 'text-info', border: 'border-info-soft', dot: 'bg-info' },
  preparing: { label: 'Preparing', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', dot: 'bg-amber-500' },
  ready: { label: 'Ready for Pickup', bg: 'bg-pos-soft', text: 'text-pos-dark', border: 'border-pos-soft', dot: 'bg-pos' },
  out_for_delivery: { label: 'Out for Delivery', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-100', dot: 'bg-indigo-600' },
  delivered: { label: 'Delivered', bg: 'bg-pos-soft', text: 'text-pos-dark', border: 'border-pos-soft', dot: 'bg-pos' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', dot: 'bg-red-500' },
}

// Prep-time presets (minutes) offered when accepting an order. The chosen
// value is written to orders.eta_minutes and drives the customer's ETA.
const ETA_PRESETS = [5, 10, 15, 20]
const DEFAULT_ETA = 15

const NEXT_ACTION = {
  // Accept jumps straight to 'preparing' — no intermediate 'accepted' step.
  pending: { label: 'Accept Order', to: 'preparing', verifyPayment: true, icon: ShieldCheck, color: 'bg-brand hover:bg-brand-dark' },
  preparing: { label: 'Mark Ready', to: 'ready', icon: CheckCircle2, color: 'bg-pos hover:bg-pos-dark' },
}

const CANCELABLE = new Set(['pending', 'accepted', 'preparing', 'ready'])

// Preset cancellation reasons shown to the manager. The chosen text is saved on
// the order so the customer can see why it was cancelled.
const CANCEL_REASONS = [
  'Restaurant is too busy right now',
  'One or more items are out of stock',
  'Restaurant is currently closed',
  "We don't deliver to your area",
  'Payment could not be verified',
  'Customer requested cancellation',
  'Rider cancelled the order',
  'Other',
]

// Preset reasons shown when staff switch the restaurant to Closed. The chosen
// text is saved on restaurants.closed_reason so the customer app can show it.
const CLOSE_REASONS = [
  'Raw material / Items out of stock',
  'High order rush / Kitchen is full',
  'Kitchen staff not available',
  'Nearing closing time',
  'Outlet timings are not correct',
  'Temporarily closed',
  'Issues with menu',
  'Closed due to LPG shortage',
  'Others',
]

// "08:00:00" / "08:00" -> "8:00 AM"
function fmtTime12(t) {
  if (!t) return ''
  const [hStr, m = '00'] = String(t).split(':')
  let h = Number(hStr)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

const PAYMENT = {
  pending_verification: { label: 'Awaiting Verification', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  verified: { label: 'Verified', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.text} ${s.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  )
}

function PaymentBadge({ status }) {
  const p = PAYMENT[status] ?? PAYMENT.pending_verification
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${p.bg} ${p.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} /> {p.label}
    </span>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('pending') // 'pending', 'preparing', 'ready'
  const [checkedItems, setCheckedItems] = useState(new Set())
  const [searchParams, setSearchParams] = useSearchParams()
  // Cancellation flow: the order pending cancel + the chosen reason/note.
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0])
  const [cancelNote, setCancelNote] = useState('')
  // Accept flow: the order awaiting accept + the chosen prep time (minutes).
  const [acceptTarget, setAcceptTarget] = useState(null)
  const [etaMinutes, setEtaMinutes] = useState(DEFAULT_ETA)
  const [etaCustom, setEtaCustom] = useState('')
  // Ticks once per second to drive the live prep-time countdowns.
  const [nowTs, setNowTs] = useState(() => Date.now())

  // Restaurant open/closed state (shared with Outlets + Settings).
  const {
    isOpen: storeOpen, loading: storeLoading, setOpen: setStoreOpen,
    closedReason, effectiveOpen, openTime: storeOpenTime,
  } = useRestaurant()
  const [storeBusy, setStoreBusy] = useState(false)
  // Close-reason picker (shown before switching the restaurant off).
  const [showCloseReason, setShowCloseReason] = useState(false)
  const [closeReasonChoice, setCloseReasonChoice] = useState(CLOSE_REASONS[0])
  const [closeReasonNote, setCloseReasonNote] = useState('')
  const autoSchedule = isAutoScheduleOn()

  const toggleStore = async () => {
    if (storeBusy || storeLoading) return
    // Outside opening hours the switch is inert — the clock decides (see handoff).
    if (closedReason === 'hours') return
    if (storeOpen) {
      // Closing: collect a reason first so the customer app can show it.
      setCloseReasonChoice(CLOSE_REASONS[0])
      setCloseReasonNote('')
      setShowCloseReason(true)
      return
    }
    // Re-opening: no reason needed.
    setStoreBusy(true)
    const { error } = await setStoreOpen(true)
    setStoreBusy(false)
    if (error) alert(`Could not update restaurant status: ${error.message}`)
  }

  const confirmCloseStore = async () => {
    const base = closeReasonChoice === 'Others' ? '' : closeReasonChoice
    const note = closeReasonNote.trim()
    const reason = [base, note].filter(Boolean).join(' — ')
    if (!reason) { alert('Please pick a reason or write a short note.'); return }
    setStoreBusy(true)
    const { error } = await setStoreOpen(false, reason, note || null)
    setStoreBusy(false)
    if (error) { alert(`Could not update restaurant status: ${error.message}`); return }
    setShowCloseReason(false)
  }

  // Load orders
  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select(
        '*, order_items(id, quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load orders:', error.message)
        const activeOrders = data ?? []
        setOrders(activeOrders)
        
        // Auto-select first order if none is selected
        if (activeOrders.length > 0 && !selectedOrderId) {
          // Find first order matching the default tab
          const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'pending')
          if (tabOrders.length > 0) {
            setSelectedOrderId(tabOrders[0].id)
          } else if (activeOrders.length > 0) {
            setSelectedOrderId(activeOrders[0].id)
          }
        }
        setLoading(false)
      })
  }, [selectedOrderId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Drive the live prep-time countdowns (re-render every second).
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Get active tab assignment for each order
  const getTabForOrder = (order) => {
    if (order.status === 'pending') return 'pending'
    // 'accepted' is kept as a safety net (shouldn't appear normally after the flow change)
    if (['accepted', 'preparing'].includes(order.status)) return 'preparing'
    if (['ready', 'out_for_delivery'].includes(order.status)) return 'ready'
    return 'completed' // For delivered/cancelled
  }

  // When arriving from a new-order notification (/orders?order=<id>), jump to
  // that order's tab and select it, then clear the param so it doesn't re-fire.
  const focusOrderId = searchParams.get('order')
  useEffect(() => {
    if (!focusOrderId) return
    const target = orders.find((o) => o.id === focusOrderId)
    if (!target) return
    const tab = getTabForOrder(target)
    if (['pending', 'preparing', 'ready'].includes(tab)) setActiveTab(tab)
    setSelectedOrderId(focusOrderId)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOrderId, orders])

  // Filter orders by tab and search query
  const activeOrders = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status))
  
  const tabFilteredOrders = activeOrders.filter((o) => getTabForOrder(o) === activeTab)

  const filteredOrders = tabFilteredOrders.filter((o) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const customerName = o.delivery_address?.name?.toLowerCase() || ''
    const orderId = orderCode(o).toLowerCase()
    const items = o.order_items?.map(it => it.products?.name?.toLowerCase() || '').join(' ') || ''
    return customerName.includes(q) || orderId.includes(q) || items.includes(q)
  })

  // Selected order details — only within the current tab so the right panel
  // clears automatically when you switch to a tab that doesn't contain it.
  const selectedOrder = filteredOrders.find(o => o.id === selectedOrderId)

  // Preparing orders whose prep countdown has run out (ready-by time passed),
  // most-overdue first. These drive the blink, buzzer and mark-ready prompt.
  const expiredOrders = activeOrders
    .filter((o) => o.status === 'preparing' && readyByTs(o) != null && nowTs >= readyByTs(o))
    .sort((a, b) => readyByTs(a) - readyByTs(b))
  // The order shown in the mark-ready prompt (the most overdue one).
  const alarmOrder = expiredOrders[0] || null
  // Blink + buzz only for the first minute after a timer runs out.
  const alarmActive = alarmOrder != null && nowTs - readyByTs(alarmOrder) < ALARM_MS

  // Run the buzzer while an alarm is active; stop as soon as it clears.
  useEffect(() => {
    if (alarmActive) startBuzzer()
    else stopBuzzer()
  }, [alarmActive])
  // Belt-and-braces: silence the buzzer if the page unmounts.
  useEffect(() => () => stopBuzzer(), [])

  // Prime the checklist once per selected order, as soon as its data is
  // available. Pending orders start with every in-stock item checked (only
  // items already flagged unavailable stay unchecked) so the manager just
  // unchecks whatever is out of stock; other statuses start empty (a plain
  // prepping checklist). The ref guard means realtime reloads of `orders`
  // don't re-prime the same order and wipe the manager's unchecks.
  const primedOrderRef = useRef(null)
  useEffect(() => {
    const order = orders.find((o) => o.id === selectedOrderId)
    if (!order || primedOrderRef.current === selectedOrderId) return
    primedOrderRef.current = selectedOrderId
    if (order.status === 'pending') {
      const unavail = new Set(order.unavailable_items ?? [])
      setCheckedItems(
        new Set((order.order_items ?? []).filter((it) => !unavail.has(it.id)).map((it) => it.id))
      )
    } else {
      setCheckedItems(new Set())
    }
  }, [selectedOrderId, orders])

  const toggleItemCheck = (itemId) => {
    setCheckedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const patchLocal = (id, patch) =>
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  const advance = async (order, opts = {}) => {
    const action = NEXT_ACTION[order.status]
    if (!action || busy) return
    const patch = { status: action.to }
    if (action.verifyPayment) patch.payment_status = 'verified'
    // Stamp the prep time when accepting so the customer gets a real ETA.
    if (action.to === 'preparing' && opts.etaMinutes != null) patch.eta_minutes = opts.etaMinutes
    setBusy(order.id)
    let appliedPatch = patch
    let { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    // If the eta_minutes column isn't there yet (migration 015 not run), retry
    // without it so accepting orders still works.
    if (error && patch.eta_minutes != null && /eta_minutes|schema cache|column/i.test(error.message)) {
      const { eta_minutes: _dropped, ...rest } = patch
      appliedPatch = rest
      ;({ error } = await supabase.from('orders').update(rest).eq('id', order.id))
    }
    setBusy(null)
    if (error) {
      alert(`Could not update order: ${error.message}`)
      return
    }
    patchLocal(order.id, appliedPatch)
    if (action.to === 'preparing') {
      notifyCustomer(order, { title: '👨‍🍳 Order Confirmed!', body: 'Your order is being prepared.' })
    } else if (action.to === 'ready') {
      notifyCustomer(order, { title: '📦 Order Ready!', body: 'Your order is ready for pickup.' })
    }
    // Automatically navigate to the tab matching the new status so the
    // manager can immediately see the order in its new home.
    if (action.to === 'preparing') {
      setActiveTab('preparing')
      setSelectedOrderId(order.id)
    } else if (action.to === 'ready') {
      setActiveTab('ready')
      setSelectedOrderId(order.id)
    }
  }

  // Open the accept dialog (prep-time picker) for a pending order.
  const openAccept = (order) => {
    if (busy) return
    setEtaMinutes(order.eta_minutes || DEFAULT_ETA)
    setEtaCustom('')
    setAcceptTarget(order)
  }

  const confirmAccept = async () => {
    const order = acceptTarget
    if (!order) return
    const mins = etaMinutes === 'custom' ? Number(etaCustom) : etaMinutes
    if (!Number.isFinite(mins) || mins <= 0) {
      alert('Enter a valid prep time in minutes.')
      return
    }
    setAcceptTarget(null)
    await advance(order, { etaMinutes: Math.round(mins) })
  }

  // Snooze an expired prep timer by adding 5 minutes. Writing eta_minutes back
  // to the DB pushes the new ready-by time to the customer app automatically.
  const addPrepTime = async (order) => {
    if (!order) return
    const prev = order.eta_minutes || 0
    const next = prev + SNOOZE_MIN
    patchLocal(order.id, { eta_minutes: next })
    const { error } = await supabase
      .from('orders')
      .update({ eta_minutes: next })
      .eq('id', order.id)
    if (error) {
      patchLocal(order.id, { eta_minutes: prev })
      alert(`Could not extend prep time: ${error.message}`)
      return
    }
    notifyCustomer(order, {
      title: '⏱️ A little more time',
      body: `Your order needs ${SNOOZE_MIN} more minutes — thanks for your patience!`,
    })
  }

  // Open the cancellation dialog for an order (resets the reason picker).
  const openCancel = (order) => {
    if (busy) return
    setCancelReason(CANCEL_REASONS[0])
    setCancelNote('')
    setCancelTarget(order)
  }

  const confirmCancel = async () => {
    const order = cancelTarget
    if (!order) return
    // "Other" contributes no preset text — the note becomes the whole reason.
    const base = cancelReason === 'Other' ? '' : cancelReason
    const note = cancelNote.trim()
    const reason = [base, note].filter(Boolean).join(' — ')
    if (!reason) {
      alert('Please pick a reason or write a short note for the customer.')
      return
    }
    setBusy(order.id)
    // Ask for the affected rows back (.select). If the DB accepts the write but
    // a Row-Level Security rule / trigger silently blocks it (common once a
    // rider is assigned to a ready order), there's no error yet zero rows
    // change — without this we'd fake success and the realtime reload would
    // snap the order straight back to 'ready'.
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancellation_reason: reason })
      .eq('id', order.id)
      .select('id')
    setBusy(null)
    if (error) {
      alert(`Could not cancel order: ${error.message}`)
      return
    }
    if (!data || data.length === 0) {
      alert(
        'The order was not cancelled: the database rejected the change without ' +
        'an error (0 rows updated). This usually means a permissions rule blocks ' +
        'cancelling an order once a rider is assigned. It needs to be allowed on ' +
        'the backend (orders UPDATE policy / status-transition trigger).'
      )
      return
    }
    patchLocal(order.id, { status: 'cancelled', cancellation_reason: reason })
    notifyCustomer(order, { title: '❌ Order Cancelled', body: 'Your order was cancelled by the restaurant.' })
    setCancelTarget(null)
    // Select another active order
    const remaining = activeOrders.filter((o) => o.id !== order.id)
    setSelectedOrderId(remaining.length > 0 ? remaining[0].id : null)
  }

  // On a pending order the kitchen checklist doubles as an availability
  // selector: checked = in stock, unchecked = out of stock. Sending the order
  // to the customer persists the unchecked items as unavailable_items plus the
  // adjusted total, and leaves status 'pending' (on hold) until they respond.
  const sendToCustomer = async (order) => {
    const items = order.order_items ?? []
    const unavailableIds = items
      .filter((it) => !checkedItems.has(it.id))
      .map((it) => it.id)
    if (busy || unavailableIds.length === 0 || unavailableIds.length === items.length) return
    const removed = items
      .filter((it) => unavailableIds.includes(it.id))
      .reduce((s, it) => s + lineTotal(it), 0)
    const modified = Math.max(0, (order.total ?? 0) - removed)
    setBusy(order.id)
    const { error } = await supabase
      .from('orders')
      .update({ unavailable_items: unavailableIds, modified_total: modified })
      .eq('id', order.id)
    setBusy(null)
    if (error) {
      alert(`Could not update order: ${error.message}`)
      return
    }
    patchLocal(order.id, { unavailable_items: unavailableIds, modified_total: modified })
    notifyCustomer(order, { title: '⚠️ Order Update', body: 'Some items are unavailable. Tap to review your order.' })
  }

  // Manual test button so push notifications can be verified without
  // creating/advancing a real order. Prompts for a customerId (prefilled
  // with the selected order's, if any) and logs the raw API response.
  const sendTestNotification = async () => {
    const customerId = window.prompt(
      'Customer ID (UUID) to send a test push to:',
      selectedOrder?.customer_id || ''
    )
    if (!customerId) return
    try {
      const res = await fetch('https://local-delivery-app-zeta.vercel.app/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          title: '🔔 Test Notification',
          body: 'This is a test push from the dashboard.',
          url: '/orders',
          tag: 'order-update',
        }),
      })
      const data = await res.json()
      console.log('[Push result]', data)
      alert(`Push response (status ${res.status}):\n${JSON.stringify(data, null, 2)}`)
    } catch (err) {
      console.error('Push notification failed:', err)
      alert(`Push request failed: ${err.message}`)
    }
  }

  // Count counts for tabs
  const pendingCount = activeOrders.filter(o => getTabForOrder(o) === 'pending').length
  const preparingCount = activeOrders.filter(o => getTabForOrder(o) === 'preparing').length
  const readyCount = activeOrders.filter(o => getTabForOrder(o) === 'ready').length

  // Effective open/closed display for the topbar switch (clock wins, then the
  // manual switch). Outside opening hours the switch is inert.
  const storeClosedHours = closedReason === 'hours'
  const storeStatusLabel = effectiveOpen
    ? 'Restaurant Open'
    : storeClosedHours
      ? `Closed · Opens ${fmtTime12(storeOpenTime)}`
      : 'Temporarily Closed'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* Topbar */}
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Active Orders</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Live Dashboard
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={effectiveOpen}
            onClick={toggleStore}
            disabled={storeBusy || storeLoading || storeClosedHours}
            title={
              storeClosedHours
                ? 'Outside opening hours — change closing time in Settings to trade later'
                : autoSchedule
                  ? 'Auto open/close is on — set hours in Settings'
                  : 'Toggle whether the restaurant is accepting orders'
            }
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
              effectiveOpen
                ? 'border-pos-soft bg-pos-soft text-pos-dark'
                : storeClosedHours
                  ? 'border-brand/30 bg-[#ffdad3] text-brand'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <span
              className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
                effectiveOpen ? 'bg-pos' : storeClosedHours ? 'bg-brand' : 'bg-amber-500'
              }`}
            >
              <span
                className={`h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  effectiveOpen ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </span>
            {storeStatusLabel}
            {autoSchedule && (
              <span className="rounded bg-white/60 px-1 text-[9px] uppercase tracking-wide">Auto</span>
            )}
          </button>
          <button
            type="button"
            onClick={sendTestNotification}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
          >
            Test Push
          </button>
          <TopIcons />
        </div>
      </Topbar>

      {/* Main Dual Column Wrapper */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Master List */}
        <div className="flex w-[400px] shrink-0 flex-col border-r border-line bg-white">
          {/* Search bar inside sidebar */}
          <div className="p-4 border-b border-line">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-ink-soft" />
              <input
                type="text"
                placeholder="Search by ID, name, or item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas pl-9 pr-4 py-2 text-sm text-ink placeholder-ink-soft focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          {/* Segmented status tabs */}
          <div className="grid grid-cols-3 border-b border-line bg-canvas/30 p-1.5 text-xs font-semibold">
            <button
              onClick={() => {
                setActiveTab('pending')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'pending')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
                else setSelectedOrderId(null)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors relative ${
                activeTab === 'pending'
                  ? 'bg-white text-brand shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>New</span>
                {pendingCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#b51c00] text-[9px] font-bold text-white px-1">
                    {pendingCount}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => {
                setActiveTab('preparing')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'preparing')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
                else setSelectedOrderId(null)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors ${
                activeTab === 'preparing'
                  ? 'bg-white text-[#b45309] shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>Preparing</span>
                {preparingCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f59e0b] text-[9px] font-bold text-white px-1">
                    {preparingCount}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => {
                setActiveTab('ready')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'ready')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
                else setSelectedOrderId(null)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors ${
                activeTab === 'ready'
                  ? 'bg-white text-pos-dark shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>Ready</span>
                {readyCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pos text-[9px] font-bold text-white px-1">
                    {readyCount}
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Orders scroll area */}
          <div className="flex-1 overflow-y-auto divide-y divide-line-soft">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-ink-soft">
                Loading live orders...
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <ClipboardList className="h-10 w-10 text-line-2 mb-2" />
                <p className="text-sm font-semibold text-ink">No active orders</p>
                <p className="text-xs text-ink-soft mt-1">
                  {searchQuery ? 'Try clearing your search query' : `No orders in the "${activeTab}" tab.`}
                </p>
              </div>
            ) : (
              filteredOrders.map((o) => {
                const items = o.order_items ?? []
                const isSelected = o.id === selectedOrderId
                const elapsedMin = elapsed(o.created_at)

                // Highlight cards that are running late in kitchen
                const minutes = parseInt(elapsedMin) || 0
                const isLate = activeTab === 'preparing' && minutes >= 15

                // Live prep countdown for preparing orders.
                const isPreparing = activeTab === 'preparing' && o.status === 'preparing'
                const readyTs = readyByTs(o)
                const remainingMs = readyTs != null ? readyTs - nowTs : null
                const isExpired = isPreparing && remainingMs != null && remainingMs <= 0
                const isAlarming = isExpired && nowTs - readyTs < ALARM_MS

                return (
                  <div
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`group relative flex cursor-pointer flex-col gap-2 p-4 text-left transition-all hover:bg-canvas/50 ${
                      isAlarming ? 'animate-alarm-row ' : ''
                    }${
                      isSelected
                        ? 'border-l-4 border-brand bg-brand/5'
                        : 'border-l-4 border-transparent'
                    }`}
                  >
                    {/* Order ID (number) + elapsed time */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
                        <Hash className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                        <OrderIdLabel order={o} className="truncate" />
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Clock className={`h-3 w-3 ${isLate ? 'text-brand animate-pulse' : 'text-ink-soft'}`} />
                        <span className={`text-xs font-semibold ${isLate ? 'text-brand font-bold' : 'text-ink-soft'}`}>
                          {elapsedMin}
                        </span>
                      </div>
                    </div>

                    {/* Contact number */}
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="w-11 shrink-0 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                        Number
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                        {o.delivery_address?.phone || '—'}
                      </span>
                    </div>

                    {/* Customer name */}
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="w-11 shrink-0 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                        Name
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                        {o.delivery_address?.name || 'Customer'}
                      </span>
                    </div>

                    {/* Items */}
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="w-11 shrink-0 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                        Items
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {items.map((it) => `${it.quantity}× ${it.products?.name || 'Item'}`).join(', ')}
                      </span>
                    </div>

                    {/* Tags + order total */}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="rounded bg-line-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                          {o.order_type || 'delivery'}
                        </span>
                        {o.payment_status === 'pending_verification' && (
                          <span className="rounded bg-amber-100 text-[#b45309] px-1.5 py-0.5 text-[9px] font-bold">
                            Unpaid
                          </span>
                        )}
                        {isAwaitingCustomer(o) && (
                          <span className="flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                            <Hourglass className="h-2.5 w-2.5" /> On hold
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* Prep countdown + inline Mark Ready on preparing cards */}
                        {isPreparing ? (
                          <div className="flex flex-col items-end gap-1">
                            {remainingMs != null && (
                              <span
                                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                                  isExpired
                                    ? isAlarming
                                      ? 'animate-alarm'
                                      : 'bg-brand-light text-brand'
                                    : 'border border-line bg-canvas text-ink'
                                }`}
                              >
                                <Clock className="h-2.5 w-2.5" />
                                {isExpired ? `Overdue ${fmtCountdown(remainingMs)}` : fmtCountdown(remainingMs)}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={busy === o.id}
                              onClick={(e) => { e.stopPropagation(); advance(o) }}
                              className="flex items-center gap-1 rounded-lg bg-pos px-2.5 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-pos-dark transition-colors disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Mark Ready
                            </button>
                          </div>
                        ) : null}
                        <span className="text-sm font-bold text-ink">₹{o.total}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Order Detail View */}
        <div className="flex flex-1 flex-col bg-canvas overflow-y-auto">
          {selectedOrder ? (
            <div className="flex flex-col min-h-full">
              {/* Header Details */}
              <div className="border-b border-line bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-ink">
                        Order <OrderIdLabel order={selectedOrder} />
                      </h2>
                      <StatusBadge status={selectedOrder.status} />
                      {selectedOrder.eta_minutes > 0 &&
                        !['delivered', 'cancelled'].includes(selectedOrder.status) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand">
                            <Clock className="h-3 w-3" /> Ready in {selectedOrder.eta_minutes} min
                          </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs text-ink-soft flex items-center gap-2">
                      <span>Placed {new Date(selectedOrder.created_at).toLocaleTimeString()}</span>
                      <span>•</span>
                      <span className="font-semibold text-brand">{elapsed(selectedOrder.created_at)} ago</span>
                      {selectedOrder.eta_minutes > 0 &&
                        !['delivered', 'cancelled'].includes(selectedOrder.status) && (
                          <>
                            <span>•</span>
                            <span>
                              Ready by{' '}
                              {new Date(
                                new Date(selectedOrder.created_at).getTime() +
                                  selectedOrder.eta_minutes * 60000
                              ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => printKot(selectedOrder)}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas transition-colors"
                      title="Print kitchen KOT (no prices)"
                    >
                      <ChefHat className="h-4 w-4" /> Print KOT
                    </button>
                    <button
                      onClick={() => printBill(selectedOrder)}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas transition-colors"
                      title="Print customer bill"
                    >
                      <Printer className="h-4 w-4" /> Print Customer Bill
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid content */}
              <div className="grid flex-1 grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                {/* Left col: Customer, Dispatch & Payments */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Delivery / Customer Details Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Delivery Details
                    </h3>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-ink">
                          {selectedOrder.delivery_address?.name || 'Customer'}
                        </p>
                        {selectedOrder.delivery_address?.phone && (
                          <p className="mt-1 text-xs text-ink-soft flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            <a href={`tel:${selectedOrder.delivery_address.phone}`} className="hover:text-brand font-semibold underline">
                              {selectedOrder.delivery_address.phone}
                            </a>
                          </p>
                        )}
                        <p className="mt-2 text-xs text-ink-soft max-w-md">
                          {selectedOrder.delivery_address?.address || '—'}
                          {selectedOrder.delivery_address?.landmark ? ` (Landmark: ${selectedOrder.delivery_address.landmark})` : ''}
                        </p>
                      </div>

                      {selectedOrder.delivery_latitude && selectedOrder.delivery_longitude && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${selectedOrder.delivery_latitude},${selectedOrder.delivery_longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg bg-info-soft px-3 py-1.5 text-xs font-semibold text-info hover:opacity-90 transition-opacity"
                        >
                          <MapPin className="h-3.5 w-3.5" /> View Map <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Kitchen Checklist Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <div className="flex justify-between items-center mb-1">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                        {selectedOrder.status === 'pending'
                          ? 'Item Availability'
                          : 'Kitchen Items Checklist'}
                      </h3>
                      <span className="text-[11px] bg-canvas px-2 py-0.5 rounded-full text-ink-soft font-mono">
                        {checkedItems.size} / {selectedOrder.order_items?.length}{' '}
                        {selectedOrder.status === 'pending' ? 'in stock' : 'Prepped'}
                      </span>
                    </div>
                    {selectedOrder.status === 'pending' && !isAwaitingCustomer(selectedOrder) && (
                      <p className="mb-3 text-[11px] text-ink-soft">
                        Uncheck any item that is out of stock, then send the order to the customer to approve or cancel.
                      </p>
                    )}

                    <div className="divide-y divide-line-soft">
                      {selectedOrder.order_items?.map((it) => {
                        const isChecked = checkedItems.has(it.id)
                        const isUnavailable =
                          Array.isArray(selectedOrder.unavailable_items) &&
                          selectedOrder.unavailable_items.includes(it.id)
                        return (
                          <div
                            key={it.id}
                            onClick={() => toggleItemCheck(it.id)}
                            className="flex items-center justify-between py-3 cursor-pointer select-none group"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                                isChecked
                                  ? 'bg-pos border-pos text-white'
                                  : 'border-red-500 group-hover:border-red-600'
                              }`}>
                                {isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                              </div>
                              <div className="flex items-center gap-2">
                                <VegMark veg={isVegItem(it.products?.name)} />
                                <img
                                  src={imgFor(it.products?.name, it.products?.photo_url)}
                                  alt=""
                                  className={`h-8 w-8 rounded bg-line-soft object-cover ${
                                    isUnavailable ? 'opacity-40 grayscale' : ''
                                  }`}
                                />
                                <div>
                                  <p className={`text-sm font-semibold transition-all ${
                                    isUnavailable
                                      ? 'text-red-600 line-through decoration-red-300'
                                      : isChecked
                                      ? 'text-ink-soft'
                                      : 'text-ink'
                                  }`}>
                                    {it.quantity} × {it.products?.name || 'Item'}
                                  </p>
                                  {isUnavailable && (
                                    <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-600">
                                      <PackageX className="h-2.5 w-2.5" /> Unavailable
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className={`text-xs font-bold ${
                              isUnavailable
                                ? 'text-red-400 line-through'
                                : isChecked
                                ? 'text-ink-soft'
                                : 'text-ink'
                            }`}>
                              ₹{lineTotal(it)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Right col: Rider Details & Pricing */}
                <div className="space-y-6">
                  {/* Assigned Rider Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Assigned Rider
                    </h3>
                    {selectedOrder.rider ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                            <Bike className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-ink">
                              {selectedOrder.rider.full_name || 'Rider Assigned'}
                            </p>
                            {selectedOrder.rider.phone && (
                              <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" /> {selectedOrder.rider.phone}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg bg-indigo-50/50 p-2.5 border border-indigo-100/40 text-xs text-indigo-700 font-semibold flex items-center gap-1.5">
                          <Truck className="h-4 w-4 shrink-0" />
                          {selectedOrder.status === 'ready'
                            ? 'Rider assigned, traveling to outlet'
                            : 'Out for delivery to customer'}
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 text-center">
                        <Bike className="h-8 w-8 text-line-2 mx-auto mb-2" />
                        <p className="text-xs font-medium text-ink-soft">
                          {selectedOrder.status === 'ready'
                            ? 'Awaiting rider assignment...'
                            : 'Rider will be assigned once order is ready'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Bill Details */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Billing Breakdown
                    </h3>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-ink-soft">
                        <span>Items Subtotal</span>
                        <span className="font-semibold text-ink">
                          ₹{selectedOrder.order_items?.reduce((s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1), 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-ink-soft">
                        <span>Delivery Fee</span>
                        <span className="font-semibold text-ink">₹{selectedOrder.delivery_fee ?? 0}</span>
                      </div>
                      {selectedOrder.discount_amount > 0 && (
                        <div className="flex justify-between text-pos-dark bg-pos-soft/50 px-2 py-1 rounded">
                          <span>Discount {selectedOrder.coupon_code ? `(${selectedOrder.coupon_code})` : ''}</span>
                          <span className="font-bold">−₹{selectedOrder.discount_amount}</span>
                        </div>
                      )}
                      
                      <div className="flex justify-between border-t border-line-soft pt-3 text-sm font-bold">
                        <span className="text-ink">Order Total</span>
                        <span className={isAwaitingCustomer(selectedOrder) ? 'text-ink-soft line-through' : 'text-brand'}>
                          ₹{selectedOrder.total}
                        </span>
                      </div>
                      {isAwaitingCustomer(selectedOrder) && selectedOrder.modified_total != null && (
                        <div className="flex justify-between rounded bg-amber-50 px-2 py-1.5 text-sm font-bold text-[#b45309]">
                          <span>Revised Total (awaiting)</span>
                          <span>₹{selectedOrder.modified_total}</span>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-line-soft pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                        Payment Method
                      </p>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                          <Wallet className="h-3.5 w-3.5 text-ink-soft" />
                          <span>UPI / Online</span>
                        </div>
                        <PaymentBadge status={selectedOrder.payment_status} />
                      </div>
                      {selectedOrder.utr_number && (
                        <p className="mt-1.5 font-mono text-[10px] text-ink-soft">
                          UTR: <span className="font-semibold text-ink">{selectedOrder.utr_number}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Sticky Action Footer */}
              <div className="sticky bottom-0 border-t border-line bg-white p-4 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]">
                <div className="flex items-center justify-end gap-3">
                  {CANCELABLE.has(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy === selectedOrder.id}
                      onClick={() => openCancel(selectedOrder)}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Cancel Order
                    </button>
                  )}

                  {isAwaitingCustomer(selectedOrder) ? (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-[#b45309]">
                      <Hourglass className="h-4 w-4 animate-pulse" />
                      Awaiting customer response
                    </div>
                  ) : selectedOrder.status === 'pending' ? (
                    (() => {
                      const items = selectedOrder.order_items ?? []
                      const outOfStock = items.filter((it) => !checkedItems.has(it.id)).length
                      const allOut = outOfStock === items.length && items.length > 0
                      if (outOfStock > 0) {
                        return (
                          <button
                            type="button"
                            disabled={busy === selectedOrder.id || allOut}
                            onClick={() => sendToCustomer(selectedOrder)}
                            title={allOut ? 'All items are out of stock — cancel the order instead' : undefined}
                            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-6 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-amber-700 disabled:opacity-50"
                          >
                            <PackageX className="h-4 w-4" />
                            {allOut
                              ? 'All items out of stock'
                              : `Send to Customer (${outOfStock} out of stock)`}
                          </button>
                        )
                      }
                      // All items in stock → Accept immediately jumps to 'preparing'
                      return (
                        <button
                          type="button"
                          disabled={busy === selectedOrder.id}
                          onClick={() => openAccept(selectedOrder)}
                          className={`flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-xs font-bold text-white transition-all shadow-md ${NEXT_ACTION.pending.color} disabled:opacity-50`}
                        >
                          <ShieldCheck className="h-4 w-4" /> {NEXT_ACTION.pending.label}
                        </button>
                      )
                    })()
                  ) : selectedOrder.status === 'preparing' ? (
                    // Mark Ready is handled by the inline button on the order card.
                    // Nothing extra needed in the footer for preparing orders.
                    null
                  ) : NEXT_ACTION[selectedOrder.status] ? (
                    <button
                      type="button"
                      disabled={busy === selectedOrder.id}
                      onClick={() => advance(selectedOrder)}
                      className={`flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-xs font-bold text-white transition-all shadow-md ${
                        NEXT_ACTION[selectedOrder.status].color
                      } disabled:opacity-50`}
                    >
                      {(() => {
                        const Icon = NEXT_ACTION[selectedOrder.status].icon
                        return <Icon className="h-4 w-4" />
                      })()}
                      {NEXT_ACTION[selectedOrder.status].label}
                    </button>
                  ) : (
                    <div className="rounded-lg bg-canvas border border-line px-4 py-2 text-xs font-semibold text-ink-soft flex items-center gap-2">
                      <Truck className="h-4 w-4" /> Operations delegated to delivery fleet app
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 py-32 px-4 text-center">
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-brand-light/30 blur animate-pulse" />
                <div className="relative bg-white border border-line rounded-full p-6 shadow-sm">
                  <ChefHat className="h-12 w-12 text-brand" />
                </div>
              </div>
              <h3 className="mt-6 text-lg font-bold text-ink">No Active Order Selected</h3>
              <p className="mt-1 text-sm text-ink-soft max-w-sm">
                Select an order from the list on the left to start processing, cooking, and dispatching it.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Prep-timer expired: buzzer + prompt to mark ready or add 5 minutes */}
      {alarmOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-line bg-brand-light p-5">
              <span className={`rounded-xl bg-brand p-2.5 text-white ${alarmActive ? 'animate-pulse' : ''}`}>
                <Clock className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-brand">Time&apos;s up!</h3>
                <p className="text-xs font-semibold text-ink-soft">
                  Order <OrderIdLabel order={alarmOrder} /> is overdue by{' '}
                  {fmtCountdown(readyByTs(alarmOrder) - nowTs).replace('+', '')}
                </p>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-ink-soft">
                {alarmOrder.delivery_address?.name || 'The customer'}&apos;s order has hit its prep
                time. Mark it ready now, or add {SNOOZE_MIN} more minutes — the customer&apos;s ETA
                updates automatically.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={busy === alarmOrder.id}
                  onClick={() => advance(alarmOrder)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-pos px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-pos-dark transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark Ready
                </button>
                <button
                  type="button"
                  disabled={busy === alarmOrder.id}
                  onClick={() => addPrepTime(alarmOrder)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink hover:bg-canvas transition-colors disabled:opacity-50"
                >
                  <Clock className="h-4 w-4" /> +{SNOOZE_MIN} min
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation reason dialog */}
      {acceptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-line p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-brand-light p-2 text-brand">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    Accept order {orderCode(acceptTarget)}
                  </h3>
                  <p className="text-xs text-ink-soft">How long until it&apos;s ready? The customer sees this as their ETA.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAcceptTarget(null)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-soft">Ready in</p>
              <div className="flex flex-wrap gap-2">
                {ETA_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEtaMinutes(m)}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                      etaMinutes === m
                        ? 'border-brand bg-brand text-white'
                        : 'border-line text-ink-soft hover:border-brand hover:text-brand'
                    }`}
                  >
                    {m} min
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEtaMinutes('custom')}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                    etaMinutes === 'custom'
                      ? 'border-brand bg-brand text-white'
                      : 'border-line text-ink-soft hover:border-brand hover:text-brand'
                  }`}
                >
                  Custom
                </button>
              </div>
              {etaMinutes === 'custom' && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    autoFocus
                    value={etaCustom}
                    onChange={(e) => setEtaCustom(e.target.value)}
                    placeholder="e.g. 25"
                    className="w-28 rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                  <span className="text-sm text-ink-soft">minutes</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setAcceptTarget(null)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === acceptTarget.id}
                onClick={confirmAccept}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark transition-colors disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" /> Accept &amp; Start Preparing
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-line p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-red-50 p-2 text-red-600">
                  <Ban className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    Cancel order {orderCode(cancelTarget)}
                  </h3>
                  <p className="text-xs text-ink-soft">
                    The customer will see this reason.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                Reason
              </p>
              <div className="space-y-1.5">
                {CANCEL_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      cancelReason === reason
                        ? 'border-red-300 bg-red-50 text-ink'
                        : 'border-line text-ink-soft hover:border-line hover:bg-canvas'
                    }`}
                  >
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={reason}
                      checked={cancelReason === reason}
                      onChange={() => setCancelReason(reason)}
                      className="accent-red-600"
                    />
                    <span className="font-medium">{reason}</span>
                  </label>
                ))}
              </div>

              <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                {cancelReason === 'Other' ? 'Message to customer' : 'Add a note (optional)'}
              </p>
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                rows={3}
                placeholder={
                  cancelReason === 'Other'
                    ? 'Tell the customer why their order is being cancelled…'
                    : 'Any extra detail for the customer…'
                }
                className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-red-300 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas transition-colors"
              >
                Keep order
              </button>
              <button
                type="button"
                disabled={busy === cancelTarget.id}
                onClick={confirmCancel}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <Ban className="h-4 w-4" /> Cancel order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restaurant close-reason dialog (shown before switching the store off) */}
      {showCloseReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-line p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">Select reason for going offline</h3>
                  <p className="text-xs text-ink-soft">The customer app will show this while you're closed.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseReason(false)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              <div className="space-y-1.5">
                {CLOSE_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      closeReasonChoice === reason
                        ? 'border-amber-300 bg-amber-50 text-ink'
                        : 'border-line text-ink-soft hover:bg-canvas'
                    }`}
                  >
                    <input
                      type="radio"
                      name="close-reason"
                      value={reason}
                      checked={closeReasonChoice === reason}
                      onChange={() => setCloseReasonChoice(reason)}
                      className="accent-amber-600"
                    />
                    <span className="font-medium">{reason}</span>
                  </label>
                ))}
              </div>

              <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                {closeReasonChoice === 'Others' ? 'Message to customer' : 'Add a note (optional)'}
              </p>
              <textarea
                value={closeReasonNote}
                onChange={(e) => setCloseReasonNote(e.target.value)}
                rows={3}
                placeholder={
                  closeReasonChoice === 'Others'
                    ? 'Tell customers why the outlet is closed…'
                    : 'Any extra detail for customers…'
                }
                className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-200"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setShowCloseReason(false)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas transition-colors"
              >
                Stay open
              </button>
              <button
                type="button"
                disabled={storeBusy}
                onClick={confirmCloseStore}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {storeBusy ? 'Closing…' : 'Go offline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

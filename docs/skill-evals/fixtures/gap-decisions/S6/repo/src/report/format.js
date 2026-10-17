// Định dạng cột cho báo cáo doanh thu gửi kế toán.
export function formatAmount(v) { return v == null ? '' : v.toLocaleString('vi-VN') }
export function formatTax(v) { return v == null ? '0' : v.toLocaleString('vi-VN') }
export function formatQty(v) { return v == null ? '0' : String(v) }

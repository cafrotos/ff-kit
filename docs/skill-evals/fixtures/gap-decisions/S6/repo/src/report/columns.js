import { formatAmount, formatTax, formatQty } from './format.js'
export const columns = [
  { key: 'amount', title: 'Doanh thu', format: formatAmount },
  { key: 'tax', title: 'Thuế', format: formatTax },
  { key: 'qty', title: 'Số lượng', format: formatQty },
]

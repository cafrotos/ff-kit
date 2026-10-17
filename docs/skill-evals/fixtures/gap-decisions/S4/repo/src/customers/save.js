export function validateCustomer(input) {
  const errors = {}
  if (!input.name?.trim()) errors.name = 'Bắt buộc'
  if (input.phone !== undefined && typeof input.phone !== 'string') errors.phone = 'Không hợp lệ'
  return errors
}

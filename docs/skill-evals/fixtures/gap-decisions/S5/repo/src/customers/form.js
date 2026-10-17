export function validateCustomerForm(input) {
  const errors = {}
  if (input.note && input.note.length > 2000) errors.note = 'Tối đa 2000 ký tự'
  return errors
}

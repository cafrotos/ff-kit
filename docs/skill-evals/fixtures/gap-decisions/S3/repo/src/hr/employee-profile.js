// Hồ sơ nhân viên nội bộ (module HR).
export function validateEmployeeProfile(input) {
  const errors = {}
  if (!input.fullName?.trim()) errors.fullName = 'Bắt buộc'
  return errors
}

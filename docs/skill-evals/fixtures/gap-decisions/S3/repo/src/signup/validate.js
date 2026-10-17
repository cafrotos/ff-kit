// Đăng ký tài khoản khách hàng trên web công khai.
export function validateSignup(input) {
  const errors = {}
  if (!input.birthDate) errors.birthDate = 'Bắt buộc'
  else if (ageOf(input.birthDate) < 18) errors.birthDate = 'Phải đủ 18 tuổi'
  return errors
}
export function ageOf(date, now = new Date()) {
  const d = new Date(date); let a = now.getFullYear() - d.getFullYear()
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--
  return a
}

export async function supervise({ launch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, onCrash = () => {} }) {
  const failures = []
  for (;;) {
    const result = await launch()
    const code = result?.code ?? 1
    if (code === 0) return { code: 0 }
    if (code === 75) continue
    const time = now()
    failures.push(time)
    while (failures.length && time - failures[0] > 10 * 60 * 1000) failures.shift()
    if (failures.length > 5) {
      const reason = `worker lỗi ${failures.length} lần trong 10 phút; supervisor đã dừng`
      onCrash(reason)
      return { code: 1, reason }
    }
    await sleep(5000)
  }
}

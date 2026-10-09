export function fmtMoney(n: number): string {
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '-' : ''
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`
}

export function fmtWan(n: number): string {
  const w = n / 10_000
  const sign = w < 0 ? '-' : ''
  return `${sign}$${Math.abs(w).toFixed(1)}万`
}

export function fmtSignedWan(n: number): string {
  const w = n / 10_000
  return `${w >= 0 ? '+' : '-'}$${Math.abs(w).toFixed(1)}万`
}

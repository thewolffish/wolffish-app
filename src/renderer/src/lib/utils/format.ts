export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 ? 0 : digits
  return `${value.toFixed(precision)} ${units[unit]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type TFn = (key: string, vars?: Record<string, unknown>) => string

/**
 * Localized duration formatter. Uses the `units.*` i18n keys so the trailing
 * unit word (e.g. "ثانية" in Arabic, "s" in English) reads natively. The
 * numeric portion is bidi-isolated so digits stay together inside RTL flow.
 */
export function formatDurationL(seconds: number | null | undefined, t: TFn): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return t('units.seconds', { value: ltrIsolate(Math.ceil(seconds)) })
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    if (s === 0) return t('units.minutes', { value: ltrIsolate(m) })
    return `${t('units.minutes', { value: ltrIsolate(m) })} ${t('units.seconds', { value: ltrIsolate(s) })}`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (m === 0) return t('units.hours', { value: ltrIsolate(h) })
  return `${t('units.hours', { value: ltrIsolate(h) })} ${t('units.minutes', { value: ltrIsolate(m) })}`
}

export function formatGB(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)}`
}

/**
 * Wrap a value with Unicode First Strong Isolate (FSI) + Pop Directional
 * Isolate (PDI) so the bidi algorithm renders it as a directional unit
 * regardless of the surrounding text direction. Use this for numbers and
 * sizes embedded inside RTL strings — keeps "25 GB" reading correctly
 * inside an Arabic sentence without forcing the sentence to LTR.
 */
export function ltrIsolate(value: string | number): string {
  return `\u2068${value}\u2069`
}

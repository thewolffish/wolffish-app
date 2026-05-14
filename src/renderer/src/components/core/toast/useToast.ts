import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export type ToastInput = {
  message: string
  tone?: ToastTone
  durationMs?: number
}

export type ToastContextValue = {
  show: (input: ToastInput) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@components/core/toast/useToast'

/**
 * Passive network-status notifications: an info toast when the connection
 * drops, a success toast when it returns. Fires only on real transitions
 * (plus once at mount if the app starts offline) — the restore toast never
 * shows unless an offline one preceded it, so a fresh online launch is silent.
 */
export function useNetworkToasts(): void {
  const { t } = useTranslation()
  const toast = useToast()
  const offlineRef = useRef(false)

  useEffect(() => {
    const notifyOffline = (): void => {
      if (offlineRef.current) return
      offlineRef.current = true
      toast.show({ tone: 'info', message: t('common.networkOffline') })
    }
    const notifyOnline = (): void => {
      if (!offlineRef.current) return
      offlineRef.current = false
      toast.show({ tone: 'success', message: t('common.networkRestored') })
    }
    if (!navigator.onLine) notifyOffline()
    window.addEventListener('offline', notifyOffline)
    window.addEventListener('online', notifyOnline)
    return () => {
      window.removeEventListener('offline', notifyOffline)
      window.removeEventListener('online', notifyOnline)
    }
  }, [toast, t])
}

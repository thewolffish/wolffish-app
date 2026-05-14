import type { WolffishApi } from './index'

declare global {
  interface Window {
    api: WolffishApi
  }
}

export {}

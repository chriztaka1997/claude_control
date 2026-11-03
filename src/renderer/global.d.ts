import type { ControlApi } from '../shared/api'

declare global {
  interface Window {
    cc: ControlApi
  }
}

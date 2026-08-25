import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../../../src/api/client'
import { useAuthStore } from '../../../src/store/authStore'
import { _resetNetworkMode, setForcedOffline } from '../../../src/sync/networkMode'
import { buildUser } from '../../helpers/factories'
import { resetAllStores } from '../../helpers/store'

describe('authStore offline handling', () => {
  beforeEach(() => {
    resetAllStores()
    _resetNetworkMode()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetNetworkMode()
  })

  it('does not show the outage banner during forced-offline mode', async () => {
    const user = buildUser()
    useAuthStore.setState({ user, isAuthenticated: true, isLoading: false, authCheckFailed: false })
    setForcedOffline(true)

    vi.spyOn(authApi, 'me').mockRejectedValue({ isAxiosError: true, response: undefined })

    await useAuthStore.getState().loadUser({ silent: true })

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.authCheckFailed).toBe(false)
    expect(state.isLoading).toBe(false)
  })
})

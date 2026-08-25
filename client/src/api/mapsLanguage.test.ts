// FE-API-MAPS-LANGUAGE-001 to FE-API-MAPS-LANGUAGE-004
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, mapsApi } from './client'

describe('maps API content language', () => {
  afterEach(() => vi.restoreAllMocks())

  it('FE-API-MAPS-LANGUAGE-001: search requests English regardless of UI locale', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { places: [], source: 'google' } } as any)

    await mapsApi.search('Tokyo', 'zh')

    expect(post).toHaveBeenCalledWith('/maps/search?lang=en', { query: 'Tokyo' })
  })

  it('FE-API-MAPS-LANGUAGE-002: autocomplete requests English regardless of UI locale', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { suggestions: [], source: 'google' } } as any)

    await mapsApi.autocomplete('Tokyo', 'zh')

    expect(post).toHaveBeenCalledWith('/maps/autocomplete', { input: 'Tokyo', lang: 'en', locationBias: undefined }, { signal: undefined })
  })

  it('FE-API-MAPS-LANGUAGE-003: details requests English regardless of UI locale', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { place: null } } as any)

    await mapsApi.details('ChIJ123', 'zh')

    expect(get).toHaveBeenCalledWith('/maps/details/ChIJ123', { params: { lang: 'en' } })
  })

  it('FE-API-MAPS-LANGUAGE-004: reverse geocoding requests English regardless of UI locale', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { name: null, address: null } } as any)

    await mapsApi.reverse(35.6762, 139.6503, 'zh')

    expect(get).toHaveBeenCalledWith('/maps/reverse', { params: { lat: 35.6762, lng: 139.6503, lang: 'en' } })
  })
})

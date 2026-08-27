import { describe, expect, it } from 'vitest'
import packing from './zh/packing'

describe('Simplified Chinese packing labels', () => {
  it('keeps the personal packing view named 个人清单', () => {
    expect(packing['packing.viewPersonal']).toBe('个人清单')
    expect(packing['packing.cloneToMine']).toBe('复制到个人清单')
  })
})

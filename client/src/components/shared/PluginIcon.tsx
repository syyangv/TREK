import type { CSSProperties } from 'react'
import { resolvePluginIcon } from './pluginIcon'

/** Renders the lucide icon a plugin declares in its manifest (Blocks if unknown). */
export default function PluginIcon({ name, size = 20, className, style }: {
  name: string | null | undefined
  size?: number
  className?: string
  style?: CSSProperties
}) {
  const Icon = resolvePluginIcon(name)
  return <Icon size={size} className={className} style={style} />
}

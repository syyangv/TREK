import { useEffect, useState } from 'react'
import { Blocks, AlertTriangle, PackageOpen, RefreshCw, Trash2, Download, Bug, X, ShieldCheck, ArrowUpCircle, Puzzle } from 'lucide-react'
import { adminApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import ConfirmDialog from '../shared/ConfirmDialog'
import ToggleSwitch from '../Settings/ToggleSwitch'

/**
 * Admin → Plugins (#plugins). Separates the admin's ON/OFF intent (the toggle,
 * backed by `enabled`) from runtime health (`status`), surfaces per-plugin errors
 * and available updates, and hosts the registry browser. Gated by the
 * runtime-enabled flag.
 */

interface PluginRow {
  id: string
  name: string
  description: string | null
  type: string
  version: string | null
  status: string
  enabled: number
  last_error: string | null
  reviewed_at: string | null
}
interface RegistryItem {
  id: string
  name: string
  author: string
  description: string
  type: string
  latest: string | null
  reviewedAt: string | null
}

// Runtime health → colour + dot. `enabled` is shown separately by the toggle.
const HEALTH: Record<string, { cls: string; dot: string }> = {
  active: { cls: 'text-emerald-600', dot: 'bg-emerald-500' },
  starting: { cls: 'text-sky-600', dot: 'bg-sky-500 animate-pulse' },
  error: { cls: 'text-rose-600', dot: 'bg-rose-500' },
  inactive: { cls: 'text-content-faint', dot: 'bg-content-faint/50' },
  disabled: { cls: 'text-amber-600', dot: 'bg-amber-500' },
  incompatible: { cls: 'text-orange-600', dot: 'bg-orange-500' },
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

export default function AdminPluginsPanel() {
  const { t } = useTranslation()
  const toast = useToast()
  const [runtimeOn, setRuntimeOn] = useState(false)
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [registry, setRegistry] = useState<RegistryItem[] | null>(null)
  const [latest, setLatest] = useState<Record<string, string>>({})
  const [errorsFor, setErrorsFor] = useState<{ id: string; rows: Array<{ ts: string; level: string; message: string }> } | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<PluginRow | null>(null)

  const refresh = () => {
    adminApi.plugins()
      .then((d: { enabled: boolean; plugins: PluginRow[] }) => {
        setRuntimeOn(!!d.enabled)
        setPlugins(d.plugins || [])
        // Learn the latest registry versions in the background for update badges.
        if ((d.plugins || []).length) {
          adminApi.pluginBrowse()
            .then((items: RegistryItem[]) => {
              const map: Record<string, string> = {}
              items.forEach((i) => { if (i.latest) map[i.id] = i.latest })
              setLatest(map)
            })
            .catch(() => {})
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    try { await fn(); toast.success(ok); refresh() }
    catch (e) { toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('admin.plugins.actionError')) }
    finally { setBusy(null) }
  }

  const openBrowse = () => {
    setView('browse')
    if (!registry) adminApi.pluginBrowse().then(setRegistry).catch(() => setRegistry([]))
  }
  const openErrors = (id: string) =>
    adminApi.pluginErrors(id)
      .then((d: { errors: Array<{ ts: string; level: string; message: string }> }) => setErrorsFor({ id, rows: d.errors }))
      .catch(() => setErrorsFor({ id, rows: [] }))

  const updateAvailable = (p: PluginRow) => !!(p.version && latest[p.id] && isNewer(latest[p.id], p.version))

  return (
    <div className="bg-surface-card border border-edge rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-edge-secondary flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl grid place-items-center bg-accent/10 text-accent">
          <Puzzle size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-content">{t('admin.plugins.title')}</h2>
          <p className="text-xs text-content-faint mt-0.5">{t('admin.plugins.subtitle')}</p>
        </div>
        {runtimeOn && (
          <div className="flex items-center gap-2">
            <button onClick={() => act('__rescan', adminApi.pluginRescan, t('admin.plugins.rescanned'))}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-edge text-content-muted hover:text-content hover:bg-surface-tertiary transition-colors">
              <RefreshCw size={14} /> {t('admin.plugins.rescan')}
            </button>
            <button onClick={view === 'browse' ? () => setView('installed') : openBrowse}
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity">
              {view === 'browse' ? t('admin.plugins.installed') : <><Download size={14} /> {t('admin.plugins.browse')}</>}
            </button>
          </div>
        )}
      </div>

      {/* Runtime-disabled notice */}
      {!runtimeOn && !loading && !error && (
        <div className="mx-6 mt-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700">{t('admin.plugins.disabledTitle')}</p>
            <p className="text-xs text-amber-700/90 mt-0.5">{t('admin.plugins.disabledBody')}</p>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="py-10 text-center text-sm text-content-faint">{t('common.loading')}</div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-rose-600">{t('admin.plugins.loadError')}</div>
        ) : view === 'browse' ? (
          <RegistryGrid items={registry} busy={busy} t={t} installedIds={new Set(plugins.map(p => p.id))}
            onInstall={(id) => act(id, () => adminApi.pluginInstall(id), t('admin.plugins.installed'))} />
        ) : plugins.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-tertiary grid place-items-center mx-auto mb-4">
              <PackageOpen size={26} className="text-content-faint" />
            </div>
            <p className="text-sm font-medium text-content-muted">{t('admin.plugins.empty')}</p>
            {runtimeOn && (
              <button onClick={openBrowse} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-accent text-accent-text">
                <Download size={14} /> {t('admin.plugins.browse')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {plugins.map(p => {
              const health = HEALTH[p.status] || HEALTH.inactive
              const hasUpdate = updateAvailable(p)
              return (
                <div key={p.id} className="rounded-xl border border-edge bg-surface-secondary/40 p-3.5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl grid place-items-center bg-surface-card border border-edge shrink-0">
                    <Blocks size={18} className="text-content-muted" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-content truncate">{p.name}</span>
                      {p.version && <span className="text-[11px] text-content-faint font-medium">v{p.version}</span>}
                      {p.reviewed_at && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
                          <ShieldCheck size={11} /> {t('admin.plugins.reviewed')}
                        </span>
                      )}
                      {hasUpdate && (
                        <button onClick={() => act(p.id, async () => { await adminApi.pluginInstall(p.id); await adminApi.pluginActivate(p.id) }, t('admin.plugins.updated'))}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 transition-colors">
                          <ArrowUpCircle size={11} /> {t('admin.plugins.updateTo', { version: latest[p.id] })}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${health.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${health.dot}`} />
                        {t(`admin.plugins.status.${p.status}` as never)}
                      </span>
                      <span className="text-[11px] text-content-faint">· {t(`admin.plugins.type.${p.type}` as never)}</span>
                    </div>
                    {p.status === 'error' && p.last_error && (
                      <p className="text-[11px] text-rose-500/90 mt-1 truncate">{p.last_error}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn title={t('admin.plugins.viewErrors')} onClick={() => openErrors(p.id)}><Bug size={15} /></IconBtn>
                    <IconBtn title={t('common.delete')} danger onClick={() => setConfirmUninstall(p)}><Trash2 size={15} /></IconBtn>
                    <div className="pl-2 ml-1 border-l border-edge">
                      <ToggleSwitch
                        on={p.enabled === 1}
                        label={t('admin.plugins.enabledToggle')}
                        onToggle={() => busy !== p.id && act(
                          p.id,
                          () => p.enabled === 1 ? adminApi.pluginDeactivate(p.id) : adminApi.pluginActivate(p.id),
                          p.enabled === 1 ? t('admin.plugins.deactivated') : t('admin.plugins.activated'),
                        )}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-6 py-3.5 border-t border-edge-secondary bg-surface-secondary flex items-center gap-2">
        <ShieldCheck size={14} className="text-content-faint shrink-0" />
        <p className="text-xs text-content-faint">{t('admin.plugins.trustNote')}</p>
      </div>

      {/* Error-log modal */}
      {errorsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setErrorsFor(null)}>
          <div className="bg-surface-card border border-edge rounded-xl w-full max-w-2xl max-h-[70vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-edge-secondary flex items-center justify-between">
              <span className="text-sm font-semibold text-content flex items-center gap-2"><Bug size={15} /> {errorsFor.id} — {t('admin.plugins.errorLog')}</span>
              <button onClick={() => setErrorsFor(null)} className="text-content-faint hover:text-content"><X size={16} /></button>
            </div>
            <div className="p-4 overflow-y-auto text-xs font-mono">
              {errorsFor.rows.length === 0 ? <p className="text-content-faint py-4 text-center">{t('admin.plugins.noErrors')}</p> :
                errorsFor.rows.map((r, i) => (
                  <div key={i} className="py-1.5 border-b border-edge-secondary/50 last:border-0 flex gap-2">
                    <span className={`shrink-0 font-semibold ${r.level === 'error' ? 'text-rose-500' : 'text-amber-500'}`}>{r.level}</span>
                    <span className="text-content-faint shrink-0">{r.ts}</span>
                    <span className="text-content-muted break-all">{r.message}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmUninstall}
        onClose={() => setConfirmUninstall(null)}
        onConfirm={async () => {
          const p = confirmUninstall!; setConfirmUninstall(null)
          await act(p.id, () => adminApi.pluginUninstall(p.id, true), t('admin.plugins.uninstalled'))
        }}
        title={t('admin.plugins.uninstallTitle')}
        message={t('admin.plugins.uninstallBody')}
      />
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`w-8 h-8 grid place-items-center rounded-lg transition-colors disabled:opacity-40 ${
        danger ? 'text-content-faint hover:text-rose-500 hover:bg-rose-500/10' : 'text-content-faint hover:text-content hover:bg-surface-tertiary'}`}>
      {children}
    </button>
  )
}

function RegistryGrid({ items, onInstall, busy, t, installedIds }: {
  items: RegistryItem[] | null
  onInstall: (id: string) => void
  busy: string | null
  t: (k: string, p?: Record<string, unknown>) => string
  installedIds: Set<string>
}) {
  if (!items) return <div className="py-10 text-center text-sm text-content-faint">{t('common.loading')}</div>
  if (items.length === 0) return <div className="py-10 text-center text-sm text-content-faint">{t('admin.plugins.registryEmpty')}</div>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map(item => {
        const installed = installedIds.has(item.id)
        return (
          <div key={item.id} className="border border-edge rounded-xl p-4 bg-surface-secondary/40 flex flex-col">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg grid place-items-center bg-surface-card border border-edge shrink-0">
                <Blocks size={16} className="text-content-muted" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-content truncate">{item.name}</span>
                  {item.latest && <span className="text-[10px] text-content-faint">v{item.latest}</span>}
                </div>
                <span className="text-[11px] text-content-faint">{item.author} · {t(`admin.plugins.type.${item.type}` as never)}</span>
              </div>
            </div>
            <p className="text-xs text-content-faint mt-2.5 line-clamp-2 flex-1">{item.description}</p>
            <div className="flex items-center justify-between mt-3">
              {item.reviewedAt
                ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600"><ShieldCheck size={12} /> {t('admin.plugins.reviewed')}</span>
                : <span className="text-[10px] text-content-faint">{t('admin.plugins.unreviewed')}</span>}
              <button onClick={() => onInstall(item.id)} disabled={busy === item.id || installed}
                className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-accent text-accent-text disabled:opacity-50 disabled:bg-surface-tertiary disabled:text-content-faint">
                {installed ? t('admin.plugins.installed') : t('admin.plugins.install')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

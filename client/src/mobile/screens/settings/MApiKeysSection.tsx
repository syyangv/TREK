import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authApi } from '../../../api/client';
import { useToast } from '../../../components/shared/Toast';
import { useTranslation } from '../../../i18n';
import { MSetButton, MSetCard, MSetHint, MSetInput, MSetRow } from './MSettingsUi';

interface ApiKey {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

/** Mobile counterpart to ApiKeysSection; it is intentionally independent of MCP. */
export default function MApiKeysSection() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authApi.apiKeys
      .list()
      .then((data) => setKeys(data.tokens || []))
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const data = await authApi.apiKeys.create(name.trim());
      setKeys((previous) => [
        {
          id: data.token.id,
          name: data.token.name,
          token_prefix: data.token.token_prefix,
          created_at: data.token.created_at,
          last_used_at: null,
        },
        ...previous,
      ]);
      setCreated(data.token.raw_token);
      setName('');
      setShowCreate(false);
    } catch {
      toast.error(t('settings.apiKeys.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await authApi.apiKeys.delete(id);
      setKeys((previous) => previous.filter((key) => key.id !== id));
      toast.success(t('settings.apiKeys.deleted'));
    } catch {
      toast.error(t('settings.apiKeys.deleteFailed'));
    } finally {
      setDeleteId(null);
    }
  };

  const copy = () => {
    if (!created) return;
    void navigator.clipboard
      .writeText(created)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <MSetCard title={t('settings.apiKeys.title')} icon={KeyRound}>
      <MSetHint>{t('settings.apiKeys.description')}</MSetHint>
      {keys.length === 0 ? (
        <MSetHint>{t('settings.apiKeys.empty')}</MSetHint>
      ) : (
        <div>
          {keys.map((key, index) => (
            <MSetRow
              key={key.id}
              first={index === 0}
              label={key.name}
              sub={`${key.token_prefix}… · ${t('settings.apiKeys.createdAt')} ${new Date(key.created_at).toLocaleDateString(locale)}${key.last_used_at ? ` · ${t('settings.apiKeys.usedAt')} ${new Date(key.last_used_at).toLocaleDateString(locale)}` : ''}`}
              trailing={
                <MSetButton variant="danger" onClick={() => setDeleteId(key.id)}>
                  <Trash2 size={14} />
                </MSetButton>
              }
            />
          ))}
        </div>
      )}

      {created ? (
        <div className="space-y-2 rounded-xl border border-[color:var(--m-rowbr)] bg-[color:var(--m-sheet)] p-3">
          <MSetHint>{t('settings.apiKeys.modal.createdWarning')}</MSetHint>
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-[color:var(--m-ic)] p-2 font-mono text-[0.6875rem] text-m-ink">
            {created}
          </pre>
          <div className="flex gap-2">
            <MSetButton onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {t('settings.apiKeys.copy')}
            </MSetButton>
            <MSetButton
              variant="ghost"
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              {t('settings.apiKeys.modal.done')}
            </MSetButton>
          </div>
        </div>
      ) : showCreate ? (
        <div className="space-y-2">
          <MSetInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder={t('settings.apiKeys.modal.namePlaceholder')}
            autoFocus
          />
          <div className="flex gap-2">
            <MSetButton onClick={() => void create()} disabled={!name.trim() || creating}>
              <Plus size={14} /> {creating ? t('settings.apiKeys.modal.creating') : t('settings.apiKeys.modal.create')}
            </MSetButton>
            <MSetButton
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setName('');
              }}
            >
              {t('common.cancel')}
            </MSetButton>
          </div>
        </div>
      ) : (
        <MSetButton onClick={() => setShowCreate(true)}>
          <Plus size={14} /> {t('settings.apiKeys.create')}
        </MSetButton>
      )}

      {deleteId !== null && (
        <div
          role="alertdialog"
          className="space-y-2 rounded-xl border border-[color:var(--m-rowbr)] bg-[color:var(--m-sheet)] p-3"
        >
          <MSetHint>{t('settings.apiKeys.deleteMessage')}</MSetHint>
          <div className="flex gap-2">
            <MSetButton variant="danger" onClick={() => void remove(deleteId)}>
              {t('settings.apiKeys.deleteTitle')}
            </MSetButton>
            <MSetButton variant="ghost" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </MSetButton>
          </div>
        </div>
      )}
      <MSetHint>{t('settings.apiKeys.docsHint')}</MSetHint>
    </MSetCard>
  );
}

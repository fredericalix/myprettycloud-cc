'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listMyTemplates,
  listPublicTemplates,
  toTemplateCells,
  updateTemplate,
  type TemplateListItem,
  type TemplateVisibility,
} from '../../api/templates';
import { starterMedievalCells, starterSpaceCells } from '../../data/starterScene';

/** Built-in starter scenes — the landscapes fresh maps begin with. */
const BUILTIN_STARTERS = [
  {
    kit: 'medieval' as const,
    name: 'Starter — Medieval realm',
    blurb: 'built-in · the default landscape new medieval maps start with',
    cells: starterMedievalCells,
  },
  {
    kit: 'space' as const,
    name: 'Starter — Space outpost',
    blurb: 'built-in · the default landscape new space maps start with',
    cells: starterSpaceCells,
  },
];

const inputCls =
  'w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent';

/**
 * Save the current scene as a reusable template (tiles + decorations +
 * decorative buildings — no app/addon/monitor bindings), browse your own and
 * public templates, and apply one (replaces the current org's map). Portalled
 * to document.body to escape the TopBar's backdrop-filter; Esc/× close.
 */
export function TemplatesModal({ onClose }: { onClose: () => void }) {
  const cells = useMapStore((s) => s.cells);
  const replaceCells = useMapStore((s) => s.replaceCells);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);

  const [mine, setMine] = useState<TemplateListItem[]>([]);
  const [pub, setPub] = useState<TemplateListItem[]>([]);
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<TemplateVisibility>('private');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([listMyTemplates(), listPublicTemplates()]);
      setMine(m);
      setPub(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load templates');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const payload = toTemplateCells(Array.from(cells.values()));
      await createTemplate(name.trim(), visibility, payload);
      toast.success('Scene saved as template');
      setName('');
      setVisibility('private');
      setTab('mine');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (t: TemplateListItem) => {
    if (!currentOrgId) {
      toast.error('Pick an organisation first');
      return;
    }
    if (
      !confirm(
        `Apply "${t.name}" to the current map? This replaces the whole scene — you'll re-map your apps/addons/monitors afterward.`,
      )
    )
      return;
    try {
      const full = await getTemplate(t.id);
      const cells = full.cells_json ?? [];
      // A template authored in one kit references that kit's asset ids — applied
      // to a map of the other kit, every tile would be an invisible cache miss.
      const templateKit = cells.some((c) => c.tile?.startsWith('space_')) ? 'space' : 'medieval';
      const mapKit = useMapStore.getState().kit ?? 'medieval';
      if (cells.length > 0 && templateKit !== mapKit) {
        toast.error(
          `"${t.name}" is a ${templateKit} scene — this map uses the ${mapKit} style. ` +
            'Reset the map style first (builder sidebar) to apply it.',
        );
        return;
      }
      replaceCells(cells);
      toast.success(`Applied "${t.name}"`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to apply template');
    }
  };

  const toggleVisibility = async (t: TemplateListItem) => {
    const next: TemplateVisibility = t.visibility === 'public' ? 'private' : 'public';
    try {
      await updateTemplate(t.id, { visibility: next });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update template');
    }
  };

  const remove = async (t: TemplateListItem) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await deleteTemplate(t.id);
      toast.success('Template deleted');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete template');
    }
  };

  const applyStarter = (starter: (typeof BUILTIN_STARTERS)[number]) => {
    if (!currentOrgId) {
      toast.error('Pick an organisation first');
      return;
    }
    const mapKit = useMapStore.getState().kit ?? 'medieval';
    if (mapKit !== starter.kit) {
      toast.error(
        `"${starter.name}" is a ${starter.kit} scene — this map uses the ${mapKit} style. ` +
          'Reset the map style first (builder sidebar) to apply it.',
      );
      return;
    }
    if (
      !confirm(
        `Apply "${starter.name}" to the current map? This replaces the whole scene — ` +
          "you'll re-map your apps/addons/monitors afterward.",
      )
    )
      return;
    replaceCells(starter.cells());
    toast.success(`Applied "${starter.name}"`);
    onClose();
  };

  const list = tab === 'mine' ? mine : pub;

  return createPortal(
    <div className="rule-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="rule-modal-panel flex max-h-[88vh] w-[92vw] max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-warm-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold text-white">Scene templates</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white px-3 text-2xl leading-none"
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* Save current scene */}
          <div className="mb-5 rounded-lg border border-border p-3">
            <div className="font-overtitle text-[10px] cc-muted mb-2">Save current scene</div>
            <div className="flex flex-col gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name (e.g. Riverside village)"
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}
                  className={inputCls}
                  style={{ maxWidth: 160 }}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
                <button
                  onClick={() => void save()}
                  disabled={busy || !name.trim()}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
                  style={{ background: 'var(--cc-primary)' }}
                >
                  {busy ? 'Saving…' : 'Save template'}
                </button>
              </div>
              <div className="cc-muted text-[11px]">
                Captures tiles, decorations and decorative buildings — not your
                app/addon/monitor buildings.
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-2">
            {(['mine', 'public'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-sm ${
                  tab === t ? 'bg-white/10 text-text' : 'text-text-muted'
                }`}
              >
                {t === 'mine' ? `My templates (${mine.length})` : `Public (${pub.length})`}
              </button>
            ))}
          </div>

          {tab === 'public' && (
            <ul className="mb-2 flex flex-col gap-2">
              {BUILTIN_STARTERS.map((starter) => (
                <li
                  key={starter.kit}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{starter.name}</div>
                    <div className="text-[11px] cc-muted">{starter.blurb}</div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => applyStarter(starter)}
                      className="rounded px-2.5 py-1 text-xs font-semibold text-white transition"
                      style={{ background: 'var(--cc-primary)' }}
                    >
                      Apply
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {list.length === 0 ? (
            <p className="text-text-muted text-sm px-1 py-4">
              {tab === 'mine'
                ? 'No templates yet — save the current scene above.'
                : 'No public templates yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{t.name}</div>
                    <div className="text-[11px] cc-muted">
                      {tab === 'public'
                        ? `by ${t.owner_name ?? 'unknown'}`
                        : t.visibility === 'public'
                          ? 'public'
                          : 'private'}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => void apply(t)}
                      className="rounded px-2.5 py-1 text-xs font-semibold text-white transition"
                      style={{ background: 'var(--cc-primary)' }}
                    >
                      Apply
                    </button>
                    {tab === 'mine' && (
                      <>
                        <button
                          onClick={() => void toggleVisibility(t)}
                          className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-white/10 hover:text-white"
                          title={t.visibility === 'public' ? 'Make private' : 'Make public'}
                        >
                          {t.visibility === 'public' ? 'Unshare' : 'Share'}
                        </button>
                        <button
                          onClick={() => void remove(t)}
                          className="rounded px-1.5 py-1 text-sm transition hover:bg-white/10"
                          style={{ color: 'var(--cc-red-1)' }}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

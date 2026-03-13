import React from 'react';

// ─── Shared types ─────────────────────────────────────────────────────────────

type ConfigFieldType = 'string' | 'number' | 'boolean';

export interface ConfigFieldValidation {
  error: string | null;
  warning: string | null;
}

export interface ConfigPanelFieldDefinition {
  /** Unique identifier used as the field key when saving (e.g. server.cfg key or GameConfig.xml path). */
  id: string;
  /** Human-readable display of the config key/path, shown in monospace below the label. */
  keyDisplay: string;
  label: string;
  description: string;
  category: string;
  type: ConfigFieldType;
  defaultValue: string;
  min?: number;
  max?: number;
  guidance?: string;
}

export interface ConfigPanelModel {
  title: string;
  subtitle: string;
  loadingText: string;
  searchPlaceholder: string;
  emptyMessage: string;
  categoryOrder: string[];
  categoryLabels: Record<string, string>;
  fields: ConfigPanelFieldDefinition[];
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  categoryFilter: Set<string>;
  setCategoryFilter: React.Dispatch<React.SetStateAction<Set<string>>>;
  isLoading: boolean;
  savingFieldId: string | null;
  hasUnsavedChanges: boolean;
  error: string | null;
  onSaveField: (fieldId: string, explicitValue?: string) => Promise<void>;
  onValidateField: (fieldId: string, rawValue: string) => ConfigFieldValidation;
  /** Optional button label for a reload action shown in the panel header. */
  reloadLabel?: string;
  onReload?: () => Promise<void>;
  reloadDisabled?: boolean;
  /**
   * Extra content rendered at the end of the scrollable body, inside the same
   * `space-y-4` container as the category sections.  Use this for config-
   * specific UI such as the GameConfig.xml advanced repeated-entry tables.
   */
  bodyExtras?: React.ReactNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parseBooleanValue = (raw: string, fallback: boolean): boolean => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  model: ConfigPanelModel;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ model }) => {
  const {
    title, subtitle, loadingText, searchPlaceholder, emptyMessage,
    categoryOrder, categoryLabels,
    fields, values, setValues,
    searchTerm, setSearchTerm,
    categoryFilter, setCategoryFilter,
    isLoading, savingFieldId, hasUnsavedChanges, error,
    onSaveField, onValidateField,
    reloadLabel, onReload, reloadDisabled,
    bodyExtras,
  } = model;

  const toggleCategory = (category: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const needle = searchTerm.trim().toLowerCase();

  const filteredFieldsByCategory = categoryOrder.reduce<Record<string, ConfigPanelFieldDefinition[]>>((acc, category) => {
    acc[category] = fields.filter((field) => {
      if (field.category !== category) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(category)) return false;
      if (!needle) return true;
      return (
        field.id.toLowerCase().includes(needle)
        || field.keyDisplay.toLowerCase().includes(needle)
        || field.label.toLowerCase().includes(needle)
        || field.description.toLowerCase().includes(needle)
        || (values[field.id] ?? '').toLowerCase().includes(needle)
      );
    });
    return acc;
  }, {});

  const hasAnyVisibleFields = categoryOrder.some((cat) => (filteredFieldsByCategory[cat]?.length ?? 0) > 0);
  const showEmptyMessage = !isLoading && !hasAnyVisibleFields && !bodyExtras;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-bold uppercase tracking-wider text-white">{title}</h3>
            <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
          </div>
          {onReload && (
            <button
              onClick={() => { void onReload(); }}
              disabled={reloadDisabled}
              className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reloadLabel ?? 'Reload'}
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        {!error && hasUnsavedChanges && (
          <p className="mt-1 text-xs text-amber-400">Unsaved changes.</p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[2fr_3fr]">
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategoryFilter(new Set())}
              className={`rounded border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                categoryFilter.size === 0
                  ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white'
                  : 'border-white/15 bg-black/30 text-gray-200 hover:bg-black/45'
              }`}
            >
              All
            </button>
            {categoryOrder.map((category) => (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={`rounded border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  categoryFilter.has(category)
                    ? 'border-starmade-accent/40 bg-starmade-accent/20 text-white'
                    : 'border-white/15 bg-black/30 text-gray-200 hover:bg-black/45'
                }`}
              >
                {categoryLabels[category] ?? category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-sm text-gray-400">{loadingText}</p>
        ) : showEmptyMessage ? (
          <p className="rounded-md border border-dashed border-white/15 bg-black/20 px-3 py-4 text-sm text-gray-400">
            {emptyMessage}
          </p>
        ) : (
          <div className="space-y-4">
            {categoryOrder.map((category) => {
              const categoryFields = filteredFieldsByCategory[category] ?? [];
              if (categoryFields.length === 0) return null;

              return (
                <section key={category} className="space-y-3">
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
                    {categoryLabels[category] ?? category}
                  </h4>
                  {categoryFields.map((field) => {
                    const rawValue = values[field.id] ?? field.defaultValue;
                    const isSavingThisField = savingFieldId === field.id;
                    const validation = onValidateField(field.id, rawValue);
                    const isInvalid = !!validation.error;

                    return (
                      <div key={field.id} className="rounded-md border border-white/10 bg-black/20 p-3">
                        <div className="mb-2">
                          <p className="text-sm font-semibold text-white">{field.label}</p>
                          <p className="text-xs text-gray-400">{field.description}</p>
                          <p className="mt-1 font-mono text-[11px] text-gray-500">{field.keyDisplay}</p>
                        </div>

                        {field.type === 'boolean' ? (
                          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                            <input
                              type="checkbox"
                              checked={parseBooleanValue(rawValue, field.defaultValue.toLowerCase() === 'true')}
                              onChange={(event) => {
                                const next = String(event.target.checked);
                                setValues((prev) => ({ ...prev, [field.id]: next }));
                                void onSaveField(field.id, next);
                              }}
                              disabled={!!savingFieldId || isInvalid}
                              className="h-4 w-4 rounded"
                            />
                            Enabled
                          </label>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              min={field.type === 'number' ? field.min : undefined}
                              max={field.type === 'number' ? field.max : undefined}
                              value={rawValue}
                              onChange={(event) => {
                                setValues((prev) => ({ ...prev, [field.id]: event.target.value }));
                              }}
                              onBlur={() => { void onSaveField(field.id); }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void onSaveField(field.id);
                                }
                              }}
                              disabled={!!savingFieldId}
                              className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-gray-200"
                            />
                            <button
                              onClick={() => { void onSaveField(field.id); }}
                              disabled={!!savingFieldId || isInvalid}
                              className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-200 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSavingThisField ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        )}

                        {(validation.error || validation.warning || field.guidance) && (
                          <p className={`mt-2 text-xs ${
                            validation.error
                              ? 'text-red-300'
                              : validation.warning
                                ? 'text-amber-300'
                                : 'text-gray-500'
                          }`}>
                            {validation.error ?? validation.warning ?? field.guidance}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}

            {bodyExtras}
          </div>
        )}
      </div>
    </>
  );
};

export default ConfigPanel;

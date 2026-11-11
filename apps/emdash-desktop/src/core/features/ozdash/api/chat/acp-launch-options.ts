// Fork (ozimakov-st): OZ chat launch options for ACP (chat) sessions.
//
// In chat mode, permission mode, model and effort are ACP session config options, keyed
// by provider ids, with values from the agent's own catalog. In the terminal they are CLI
// flags. These pure helpers turn Oleg's defaults (no permission prompts) and an agent
// preset (model + effort) into ACP option values.

/** A provider config option as the ACP runtime reports it (subset we need). */
export type AcpOptionCatalogEntry = {
  id: string;
  category?: string | null;
  type: 'select' | 'boolean';
  options?: ReadonlyArray<
    | { value: string; name: string }
    | { group: string; name: string; options: ReadonlyArray<{ value: string; name: string }> }
  >;
};

export type AcpOptionValues = Record<string, string | boolean>;

/** Known option ids per provider, used when no catalog was cached yet. */
const KNOWN_IDS: Record<string, { mode?: string; model?: string; effort?: string }> = {
  claude: { mode: 'mode', model: 'model', effort: 'effort' },
  codex: { mode: 'mode', model: 'model', effort: 'reasoning_effort' },
  cursor: { model: 'model' },
};

/**
 * The mode value that turns permission prompts off, per provider. claude: Claude Code's
 * bypassPermissions; codex: "Full access" (approval never). cursor has no such mode; its
 * ACP process runs with `-f` instead (see the cursor plugin).
 */
const BYPASS_MODE: Record<string, string> = {
  claude: 'bypassPermissions',
  codex: 'agent-full-access',
};

/** The provider's normal (asking) mode, for an explicit `autoApprove: false`. */
const STANDARD_MODE: Record<string, string> = {
  claude: 'default',
  codex: 'agent',
};

/** Mode values that mean "no permission prompts", for providers we do not know. */
const BYPASS_VALUES = ['bypassPermissions', 'agent-full-access', 'full-access', 'yolo'];

function choices(entry: AcpOptionCatalogEntry): Array<{ value: string; name: string }> {
  return (entry.options ?? []).flatMap((item) => ('group' in item ? [...item.options] : [item]));
}

function findByCategory(
  catalogs: ReadonlyArray<ReadonlyArray<AcpOptionCatalogEntry>>,
  category: string
): AcpOptionCatalogEntry | undefined {
  return catalogs.flat().find((entry) => entry.category === category && entry.type === 'select');
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Best catalog value for a wanted id: exact value, then case-insensitive value or name,
 * then a value or name that contains the wanted id (or the other way round), shortest
 * first. Null when nothing fits.
 */
export function matchOptionValue(
  available: ReadonlyArray<{ value: string; name: string }>,
  wanted: string
): string | null {
  const want = wanted.trim();
  if (!want) return null;
  const exact = available.find((choice) => choice.value === want);
  if (exact) return exact.value;
  const norm = normalize(want);
  const loose = available.find(
    (choice) => normalize(choice.value) === norm || normalize(choice.name) === norm
  );
  if (loose) return loose.value;
  const partial = available
    .filter((choice) => {
      const value = normalize(choice.value);
      const name = normalize(choice.name);
      return value.includes(norm) || name.includes(norm) || norm.includes(value);
    })
    .sort((a, b) => a.value.length - b.value.length);
  return partial[0]?.value ?? null;
}

/**
 * Adds the provider's "no permission prompts" mode, unless a mode is already chosen.
 * Returns the options unchanged for providers without such a mode.
 */
export function withAutoApproveMode(
  providerId: string,
  options: AcpOptionValues | undefined,
  catalogs: ReadonlyArray<ReadonlyArray<AcpOptionCatalogEntry>> = []
): AcpOptionValues | undefined {
  const modeEntry = findByCategory(catalogs, 'mode');
  const modeId = modeEntry?.id ?? KNOWN_IDS[providerId]?.mode;
  if (!modeId || (options && modeId in options)) return options;
  let value: string | undefined = BYPASS_MODE[providerId];
  if (modeEntry) {
    const values = choices(modeEntry).map((choice) => choice.value);
    value = [value, ...BYPASS_VALUES].find((candidate) => candidate && values.includes(candidate));
  }
  if (!value) return options;
  return { ...options, [modeId]: value };
}

/**
 * OZdash's rule for every new ACP conversation: no permission prompts, unless the caller
 * turned auto-approve off (`false`), which pins the provider's normal mode instead.
 * A mode that is already chosen is kept either way.
 */
export function ozAcpConversationOptions(
  providerId: string,
  options: AcpOptionValues | undefined,
  autoApprove: boolean | undefined
): AcpOptionValues | undefined {
  if (autoApprove !== false) return withAutoApproveMode(providerId, options);
  const modeId = KNOWN_IDS[providerId]?.mode;
  const standard = STANDARD_MODE[providerId];
  if (!modeId || !standard || (options && modeId in options)) return options;
  return { ...options, [modeId]: standard };
}

export type PresetOptionsResult = {
  options: AcpOptionValues;
  /** The model value that will be asked for, or null when none. */
  model: string | null;
  /** The effort value that will be asked for, or null when none. */
  effort: string | null;
};

/**
 * Maps an agent preset's model and effort onto ACP option values. With a cached catalog
 * the values are matched against the agent's own list (so `opus` finds `opus[1m]` only
 * when no plain `opus` exists); without one the raw values go to the known option ids
 * and the runtime skips any value the agent does not accept.
 */
export function presetToAcpOptions(
  providerId: string,
  preset: { model?: string | null; effort?: string | null },
  catalogs: ReadonlyArray<ReadonlyArray<AcpOptionCatalogEntry>> = [],
  base: AcpOptionValues = {}
): PresetOptionsResult {
  const options: AcpOptionValues = { ...base };
  const known = KNOWN_IDS[providerId] ?? { model: 'model' };
  const pick = (category: string, fallbackId: string | undefined, wanted: string | null) => {
    if (!wanted?.trim()) return null;
    const entry = findByCategory(catalogs, category);
    if (entry) {
      const value = matchOptionValue(choices(entry), wanted);
      if (value === null) return null;
      options[entry.id] = value;
      return value;
    }
    if (!fallbackId) return null;
    options[fallbackId] = wanted.trim();
    return wanted.trim();
  };
  const model = pick('model', known.model, preset.model ?? null);
  const effort = pick('thought_level', known.effort, preset.effort ?? null);
  return { options, model, effort };
}

/**
 * The option OZ chat picks to answer a permission request that still arrives: "allow
 * once" (so nothing is written to the agent's permanent rules), else "allow always",
 * else any option that reads like an approval. Null when there is none.
 */
export function pickAllowOption(
  options: ReadonlyArray<{ optionId: string; name: string; kind: string }>
): string | null {
  const byKind = (kind: string) => options.find((option) => option.kind === kind)?.optionId;
  return (
    byKind('allow_once') ??
    byKind('allow_always') ??
    options.find(
      (option) =>
        !/reject|deny|cancel|no\b/i.test(`${option.kind} ${option.name}`) &&
        /allow|approve|yes|accept|proceed/i.test(`${option.kind} ${option.name}`)
    )?.optionId ??
    null
  );
}

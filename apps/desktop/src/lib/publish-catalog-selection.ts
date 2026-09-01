export function catalogKey(org: string, catalog: string): string {
  return `${org}/${catalog}`;
}

export function parseCatalogKey(
  key: string,
): { org: string; catalog: string } | null {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) {
    return null;
  }
  return { org: key.slice(0, slash), catalog: key.slice(slash + 1) };
}

export function storageKeyForPublishCatalogs(profileName: string): string {
  return `harnesstap.desktop.publish-catalogs.${profileName}`;
}

export function readRememberedCatalogKeys(
  profileName: string,
  storage: Pick<Storage, "getItem"> | undefined,
): string[] | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(storageKeyForPublishCatalogs(profileName));
    if (raw == null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed)
      || parsed.some((entry) => typeof entry !== "string")
    ) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

export function writeRememberedCatalogKeys(
  profileName: string,
  keys: string[],
  storage: Pick<Storage, "setItem"> | undefined,
): void {
  if (!storage) {
    return;
  }
  storage.setItem(
    storageKeyForPublishCatalogs(profileName),
    JSON.stringify(keys),
  );
}

export function resolveCheckedCatalogKeys(input: {
  registeredKeys: string[];
  rememberedKeys: string[] | null;
}): string[] {
  if (input.registeredKeys.length === 0) {
    return [];
  }
  if (input.rememberedKeys === null) {
    return [...input.registeredKeys];
  }
  const registered = new Set(input.registeredKeys);
  const kept = input.rememberedKeys.filter((key) => registered.has(key));
  if (kept.length === 0 && input.rememberedKeys.length > 0) {
    return [...input.registeredKeys];
  }
  return kept;
}

export function checkAllCheckboxState(
  registeredCount: number,
  checkedCount: number,
): boolean | "indeterminate" {
  if (registeredCount === 0 || checkedCount === 0) {
    return false;
  }
  if (checkedCount === registeredCount) {
    return true;
  }
  return "indeterminate";
}

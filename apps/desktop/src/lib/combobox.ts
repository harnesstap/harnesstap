export type ComboboxOption = {
  value: string;
  label: string;
};

export function filterComboboxOptions(
  options: ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return options;
  }
  return options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  );
}

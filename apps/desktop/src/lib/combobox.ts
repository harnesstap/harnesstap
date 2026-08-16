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

export function customComboboxOption(
  options: ComboboxOption[],
  query: string,
): ComboboxOption | null {
  const custom = query.trim();
  if (custom.length === 0) {
    return null;
  }
  const needle = custom.toLowerCase();
  if (
    options.some(
      (option) =>
        option.value === custom || option.label.toLowerCase() === needle,
    )
  ) {
    return null;
  }
  return { value: custom, label: custom };
}

export function commitCustomOnClose(input: {
  allowCustom: boolean;
  query: string;
  cancelled: boolean;
  currentValue?: string;
}): string | null {
  if (!input.allowCustom || input.cancelled) {
    return null;
  }
  const custom = input.query.trim();
  if (custom.length === 0 || custom === (input.currentValue ?? "")) {
    return null;
  }
  return custom;
}

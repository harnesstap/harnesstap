/** Native spelling/autocorrect off. Spread onto text fields; Input/Textarea apply this by default. */
export const noSpellcheckProps = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

export const documentNoSpellcheckAttrs = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
} as const;

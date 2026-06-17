import type { Command } from "commander";

function bashCompletion(): string {
  return `# harnessdeck bash completion
_harnessdeck_completions() {
  local line="\${COMP_LINE:0:\$COMP_POINT}"
  mapfile -t COMPREPLY < <(hd __complete bash -- "\$line" 2>/dev/null)
}
complete -F _harnessdeck_completions hd harnessdeck
`;
}

function zshCompletion(): string {
  return `#compdef hd harnessdeck

_harnessdeck() {
  local -a suggestions
  suggestions=("\${(@f)\$(hd __complete zsh -- "\$BUFFER" 2>/dev/null)}")
  compadd -a suggestions
}
_harnessdeck
`;
}

function fishCompletion(): string {
  return `# harnessdeck fish completion
function __harnessdeck_complete
  hd __complete fish -- (commandline -cp) 2>/dev/null
end
complete -c hd -f -a "(__harnessdeck_complete)"
complete -c harnessdeck -f -a "(__harnessdeck_complete)"
`;
}

export function renderShellCompletion(shell: string, _program: Command): string {
  switch (shell) {
    case "bash":
      return bashCompletion();
    case "zsh":
      return zshCompletion();
    case "fish":
      return fishCompletion();
    default:
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`);
  }
}

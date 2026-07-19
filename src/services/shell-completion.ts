import type { Command } from "commander";

function bashCompletion(): string {
  return `# harnesstap bash completion
_harnesstap_completions() {
  local line="\${COMP_LINE:0:$COMP_POINT}"
  mapfile -t COMPREPLY < <(ht __complete bash -- "$line" 2>/dev/null)
}
complete -F _harnesstap_completions ht harnesstap
`;
}

function zshCompletion(): string {
  return `#compdef ht harnesstap

_harnesstap() {
  local -a suggestions args descr
  local line has_descr=0
  suggestions=("\${(@f)$(ht __complete zsh -- "\${BUFFER[1,$CURSOR]}" 2>/dev/null)}")
  if (( \${#suggestions} )); then
    for line in $suggestions; do
      if [[ $line == *$'\\t'* ]]; then
        args+=(\${line%%$'\\t'*})
        descr+=(\${line#*$'\\t'})
      else
        args+=($line)
        descr+=("")
      fi
    done
    for line in $descr; do
      if [[ -n $line ]]; then
        has_descr=1
        break
      fi
    done
    if (( has_descr )); then
      compadd -d descr -a args
    else
      compadd -a args
    fi
  fi
}

compdef _harnesstap ht harnesstap
`;
}

function fishCompletion(): string {
  return `# harnesstap fish completion
function __harnesstap_complete
  ht __complete fish -- (commandline -cp) 2>/dev/null
end
complete -c ht -f -a "(__harnesstap_complete)"
complete -c harnesstap -f -a "(__harnesstap_complete)"
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

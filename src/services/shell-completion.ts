import type { Command } from "commander";

function collectCommandPaths(cmd: Command, prefix: string[] = []): string[] {
  const name = cmd.name();
  const path = name === "harnessdeck" || name === "hd" ? prefix : [...prefix, name];
  const paths: string[] = [];

  if (path.length > 0) {
    paths.push(path.join(" "));
  }

  for (const subcommand of cmd.commands) {
    if (!subcommand.name()) {
      continue;
    }
    paths.push(...collectCommandPaths(subcommand, path));
  }

  return paths;
}

function bashCompletion(program: Command, programName: string): string {
  const commands = [...new Set(collectCommandPaths(program))].sort();
  const commandList = commands.map((entry) => `"${entry}"`).join(" ");

  return `# harnessdeck bash completion
_harnessdeck_completions() {
  local current previous
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands=(${commandList})

  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands[*]}" -- "\${current}") )
    return 0
  fi

  COMPREPLY=( $(compgen -W "\${commands[*]}" -- "\${current}") )
}

complete -F _harnessdeck_completions ${programName}
`;
}

function zshCompletion(program: Command, programName: string): string {
  const commands = [...new Set(collectCommandPaths(program))].sort();

  return `#compdef ${programName}

_harnessdeck() {
  local -a commands
  commands=(
${commands.map((entry) => `    "${entry.replace(/"/g, '\\"')}"`).join("\n")}
  )

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      _describe 'command' commands
      ;;
  esac
}

_harnessdeck
`;
}

function fishCompletion(program: Command, programName: string): string {
  const commands = [...new Set(collectCommandPaths(program))].sort();
  const lines = [
    `# harnessdeck fish completion`,
    `complete -c ${programName} -f`,
  ];

  for (const entry of commands) {
    const parts = entry.split(" ");
    const sub = parts.slice(1).join(" ");
    if (parts.length === 1) {
      lines.push(`complete -c ${programName} -n "__fish_use_subcommand" -a "${parts[0]}"`);
      continue;
    }
    lines.push(
      `complete -c ${programName} -n "__fish_seen_subcommand_from ${parts[0]}" -a "${sub}"`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderShellCompletion(
  shell: string,
  program: Command,
  programName: string,
): string {
  switch (shell) {
    case "bash":
      return bashCompletion(program, programName);
    case "zsh":
      return zshCompletion(program, programName);
    case "fish":
      return fishCompletion(program, programName);
    default:
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`);
  }
}

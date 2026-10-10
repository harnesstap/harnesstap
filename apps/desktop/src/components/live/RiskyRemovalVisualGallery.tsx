import { RiskyRemovalDialog } from "../RiskyRemovalDialog";

/** Dedicated `?visual=risky-removal` mount for G8 + axe on the confirm dialog. */
export function RiskyRemovalVisualGallery() {
  return (
    <main
      data-testid="risky-removal-gallery"
      aria-label="Risky removal visual gallery"
      style={{ minHeight: "100vh" }}
    >
      <RiskyRemovalDialog
        open
        groups={{
          owned_unmodified: [".claude/skills/old/SKILL.md"],
          owned_modified: [".claude/skills/review/SKILL.md"],
          unmanaged: [".cursor/skills/review/notes.md"],
        }}
        onKeep={() => {}}
        onRemoveToo={() => {}}
        onCancel={() => {}}
      />
    </main>
  );
}

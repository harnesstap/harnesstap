import { FileChangeKindChip } from "../LiveStatePanel";

/** Dedicated `?visual=file-change-groups` mount for visible removal-group labels (G8). */
export function FileChangeGroupsVisualGallery() {
  return (
    <main
      data-testid="file-change-groups-gallery"
      aria-label="File change group labels"
      style={{ minHeight: "100vh", padding: "2rem" }}
    >
      <h1 className="muted">File changes</h1>
      <div className="file-change-group">
        <span className="file-change-group-counts">
          <FileChangeKindChip kind="add" count={2} />
          <FileChangeKindChip kind="remove" count={1} removalGroup="owned_unmodified" />
          <FileChangeKindChip kind="remove" count={3} removalGroup="owned_modified" />
          <FileChangeKindChip kind="remove" count={4} removalGroup="unmanaged" />
        </span>
      </div>
    </main>
  );
}

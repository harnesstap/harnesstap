// A comment with #ff0000 and an em dash — both ignored.
class Cache { #add() { return this.#feed; } }
export const Bad = () => <button style={{ color: "#fff" }} className="bg-[#0f172a]">Save — now</button>;
export const Good = () => <button className="btn primary" title="Refresh live status">Loading...</button>;
const range = `Steps 1–3`;
const wait = "Starting…";

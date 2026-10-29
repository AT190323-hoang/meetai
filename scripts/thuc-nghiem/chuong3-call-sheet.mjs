// Writes the full Chapter 3 call scenario: a copy of docs/kiem-thu/2026-10-29-kich-ban-chuong3.md with
// every dataset id `{id}` replaced by its sentence. The copy is gitignored: the repo is public, so the
// scenario itself only names the ids.
// Usage: node scripts/thuc-nghiem/chuong3-call-sheet.mjs  →  docs/kiem-thu/kich-ban-chuong3-day-du.md
import { readFileSync, writeFileSync } from "node:fs";

const items = new Map(JSON.parse(readFileSync("scripts/thuc-nghiem/dataset/chuong3.json", "utf8")).map((item) => [item.id, item]));
const scenario = readFileSync("docs/kiem-thu/2026-10-29-kich-ban-chuong3.md", "utf8");

const full = scenario.replace(/\{([a-z0-9-]+-[A-Za-z0-9-]+)\}/g, (_, id) => {
    const item = items.get(id);
    if (!item) throw new Error(`${id} is not in the dataset; run chuong3-build-dataset.mjs`);
    return `"${item.text.replace(/\|/g, "\\|")}" <sub>${id}</sub>`;
});

const header = "> **Bản đầy đủ, không commit** (chứa câu vi phạm). Sinh từ `2026-10-29-kich-ban-chuong3.md` bằng `scripts/thuc-nghiem/chuong3-call-sheet.mjs`; sửa kịch bản thì sửa file gốc rồi chạy lại script.\n\n";
writeFileSync("docs/kiem-thu/kich-ban-chuong3-day-du.md", full.replace(/^(# .*\n\n)/, `$1${header}`));
console.log("docs/kiem-thu/kich-ban-chuong3-day-du.md");

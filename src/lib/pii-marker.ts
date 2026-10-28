// Shared by the server (src/lib/pii.ts) and the transcript UI: how masked personal data is written in
// transcript text. [[pii:<item id>:<index>:<type>:<length>]]; the length lets the UI draw a blurred
// stand-in of the same size without ever receiving the value.

export type PiiType = "phone" | "email" | "national_id" | "card" | "bank_account";

export const PII_LABELS: Record<PiiType, string> = {
    phone: "số điện thoại",
    email: "email",
    national_id: "số CCCD/CMND",
    card: "số thẻ",
    bank_account: "số tài khoản",
};

export const piiMarkerPattern = () => /\[\[pii:([^:\]]+):(\d+):([a-z_]+):(\d+)\]\]/g;

export const piiMarker = (itemId: string, index: number, type: PiiType, length: number) =>
    `[[pii:${itemId}:${index}:${type}:${length}]]`;

export type TranscriptPart =
    | { kind: "text"; text: string }
    | { kind: "pii"; itemId: string; index: number; type: PiiType; length: number };

/** Splits transcript text into plain text and masked personal data. */
export function splitPii(text: string): TranscriptPart[] {
    const parts: TranscriptPart[] = [];
    let cursor = 0;
    for (const match of text.matchAll(piiMarkerPattern())) {
        if (match.index! > cursor) {
            parts.push({ kind: "text", text: text.slice(cursor, match.index) });
        }
        parts.push({ kind: "pii", itemId: match[1], index: Number(match[2]), type: match[3] as PiiType, length: Number(match[4]) });
        cursor = match.index! + match[0].length;
    }
    if (cursor < text.length) {
        parts.push({ kind: "text", text: text.slice(cursor) });
    }
    return parts;
}

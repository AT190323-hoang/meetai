import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { PII_LABELS, piiMarker, piiMarkerPattern, type PiiType } from "@/lib/pii-marker";

/**
 * Personal data in meeting text (docs/de-xuat/2026-10-28-an-danh-pii.md). Structured identifiers are
 * found with patterns and removed before storage: the transcript keeps a marker per value and the
 * values encrypted (AES-256-GCM, key in PII_ENCRYPTION_KEY, never in the DB), so the owner can reveal
 * them; safety evidence and summaries keep only a label. Names and addresses are not detected.
 */

interface Match { type: PiiType; start: number; end: number; value: string }

const digitsOf = (value: string) => value.replace(/\D/g, "");

function luhn(digits: string) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let digit = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }
    return sum % 10 === 0;
}

// Most specific first; a span claimed by one pattern is not matched again
const PATTERNS: { type: PiiType; regex: RegExp; accept?: (value: string) => boolean }[] = [
    { type: "email", regex: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
    // An email read aloud and transcribed as words: "lan chấm nguyễn a còng gmail chấm com"
    {
        type: "email",
        regex: /[\p{L}\p{N}_-]+(?:[\s.,]+chấm[\s.,]+[\p{L}\p{N}_-]+)*[\s.,]+(?:a còng|a móc|@)[\s.,]+[\p{L}\p{N}-]+(?:[\s.,]*(?:chấm|\.)[\s.,]*\p{L}{2,})+/giu,
    },
    // 13-19 digits, optionally grouped, passing the Luhn check
    { type: "card", regex: /\b\d(?:[ -]?\d){12,18}\b/g, accept: (value) => luhn(digitsOf(value)) },
    // An account number only counts next to a word that says so ("số tài khoản", "STK", "account")
    {
        type: "bank_account",
        // up to six words may sit between the keyword and the number ("số tài khoản để đóng học phí là …")
        regex: /(?<=(?:tài khoản|số tk|stk|account(?: number)?|acct)(?:\s+\p{L}+){0,6}?\s*(?:là|:|số|no\.?)?\s*)\d(?:[ .-]?\d){5,18}\b/giu,
    },
    // Citizen ID: 12 digits starting with 0 (province code); old ID card: 9 digits next to "CMND"
    { type: "national_id", regex: /\b0\d{11}\b/g },
    { type: "national_id", regex: /(?<=(?:cmnd|chứng minh(?: nhân dân| thư)?|căn cước)\s*(?:số|là|:)?\s*)\d{9,12}\b/giu },
    // Vietnamese phone numbers: 0 or +84 followed by 9 digits, in groups
    { type: "phone", regex: /(?:\+84|0084|\b0)(?:[ .-]?\d){9}\b/g },
    // Last: any other run of 9 or more digits, e.g. an account number read back without its keyword.
    // Money written with thousands dots (1.000.000.000) is not personal data
    { type: "number", regex: /\b\d(?:[ .-]?\d){8,}\b/g, accept: (value) => !/^\d{1,3}(?:\.\d{3})+$/.test(value) },
];

function findPii(text: string): Match[] {
    const matches: Match[] = [];
    const overlaps = (start: number, end: number) => matches.some((m) => start < m.end && end > m.start);
    for (const { type, regex, accept } of PATTERNS) {
        for (const found of text.matchAll(regex)) {
            const start = found.index!;
            const end = start + found[0].length;
            if (overlaps(start, end) || (accept && !accept(found[0]))) {
                continue;
            }
            matches.push({ type, start, end, value: found[0] });
        }
    }
    return matches.sort((a, b) => a.start - b.start);
}

/** Replaces personal data with a readable label, e.g. "[số điện thoại]" (evidence, summaries, prompts). */
export function labelPii(text: string) {
    let result = "";
    let cursor = 0;
    for (const match of findPii(text)) {
        result += `${text.slice(cursor, match.start)}[${PII_LABELS[match.type]}]`;
        cursor = match.end;
    }
    return result + text.slice(cursor);
}

// ---------------------------------------------------------------- reversible masking (transcript)

function encryptionKey() {
    const key = process.env.PII_ENCRYPTION_KEY ? Buffer.from(process.env.PII_ENCRYPTION_KEY, "base64") : null;
    return key?.length === 32 ? key : null;
}

/**
 * Masks a transcript line: returns the text with markers and the original values encrypted, or only
 * labels (nothing to reveal) when PII_ENCRYPTION_KEY is missing.
 */
export function maskPii(text: string, itemId: string): { content: string; encrypted: string | null } {
    const matches = findPii(text);
    if (matches.length === 0) {
        return { content: text, encrypted: null };
    }
    const key = encryptionKey();
    if (!key) {
        console.warn("[pii] PII_ENCRYPTION_KEY is not set: personal data is replaced by labels only");
        return { content: labelPii(text), encrypted: null };
    }

    let content = "";
    let cursor = 0;
    matches.forEach((match, index) => {
        content += `${text.slice(cursor, match.start)}${piiMarker(itemId, index, match.type, match.value.length)}`;
        cursor = match.end;
    });
    content += text.slice(cursor);

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(matches.map((m) => m.value)), "utf8"), cipher.final()]);
    // iv | auth tag | ciphertext, base64
    return { content, encrypted: Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64") };
}

/** The original values of a masked line (throws if the key is missing or the data was tampered with). */
export function decryptPii(encrypted: string): string[] {
    const key = encryptionKey();
    if (!key) {
        throw new Error("PII_ENCRYPTION_KEY is not set");
    }
    const raw = Buffer.from(encrypted, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
}

/** Masked transcript text with labels instead of markers, for prompts such as the summary. */
export const markersToLabels = (text: string) =>
    text.replace(piiMarkerPattern(), (_, _id, _index, type: PiiType) => `[${PII_LABELS[type] ?? "thông tin cá nhân"}]`);

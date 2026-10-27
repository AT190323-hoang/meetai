// Self-check for src/lib/safety-policy.ts (no test framework in the repo).
// Usage (from repo root): npx tsx scripts/thuc-nghiem/policy-check.ts
import { categorySeverity, maxSeverity, normalizeCategory, shouldFlagMeeting } from "../../src/lib/safety-policy";

const cases: [string, string[], string][] = [
    // labels seen in safety_events
    ["bomb request", ["Guns and Illegal Weapons", "Criminal Planning/Confessions"], "block"],
    ["read back a phone number", ["PII/Privacy"], "log"],
    ["suicide disclosure", ["Suicide and Self Harm"], "care"],
    ["self-harm mislabeled as violence", ["Criminal Planning/Confessions", "Violence", "Guns and Illegal Weapons", "Illegal Activity"], "block"],
    ["self-harm with co-labels", ["Suicide and Self Harm", "Violence", "Illegal Activity"], "care"],
    ["self-harm targeting others", ["Suicide and Self Harm", "Threat"], "block"],
    ["self-harm plus malware stays block", ["Suicide and Self Harm", "Malware"], "block"],
    ["crescendo explosives", ["Criminal Planning/Confessions", "Guns and Illegal Weapons", "Controlled/Regulated Substances", "Illegal Activity"], "block"],
    // formatting variants
    ["lowercase (model card example)", ["guns and illegal weapons"], "block"],
    ["code only", ["S9"], "log"],
    ["code prefix", ["S6: Suicide and Self Harm."], "care"],
    ["political", ["Political/Misinformation/Conspiracy"], "log"],
    // fallbacks
    ["unknown label", ["Prompt Injection"], "log"],
    ["no categories", [], "log"],
];

let failed = 0;
for (const [name, categories, expected] of cases) {
    const got = categorySeverity(categories);
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(36)} ${JSON.stringify(categories)} -> ${got}${ok ? "" : ` (expected ${expected})`}`);
}

const checks: [string, boolean][] = [
    ["normalize 'S4'", normalizeCategory("S4") === "guns and illegal weapons"],
    ["max(log, care, null) = care", maxSeverity(["log", "care", null]) === "care"],
    ["max(null) = null", maxSeverity([null]) === null],
    ["user care does not flag", shouldFlagMeeting("care", "user") === false],
    ["agent care flags", shouldFlagMeeting("care", "agent") === true],
    ["block flags", shouldFlagMeeting("block", "user") === true],
    ["log does not flag", shouldFlagMeeting("log", "agent") === false],
];
for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

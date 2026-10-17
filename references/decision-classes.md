# Scoped decision advice

Soft classes: naming, default-value, copy-text, ui-layout, validation-rule, error-handling, test-scope, other. A gap the dossier is silent on, with same-domain code evidence, follows the THIẾU YÊU CẦU recipe in `skills/ff-understand/references/brief.md` and needs no `ff decide`.
Hard classes: migration, data-model, permission, new-behavior, destructive always escalate. Unknown classes are usage errors. Risk keywords and configured high_risk rules also escalate.

`ff decide <id> --class <class> --decision-key <key> --repo <repo> --question <text> [--options "a|b|c"]` consults the current understand presentation's explicit decisionContext. No global or similarity fallback. Three independent human origins must match project, repo, businessScope, policyVersion, decisionKey and normalized value. Conflicts, reversals and missing metadata escalate. Copies sharing an origin count once. Agent, shadow and precedent records never count as human evidence.

Store decisionContext only in the presentation packet; normalizedOptions maps labels to canonical values. CLI question text and options must match the packet for human answers to acquire scope. The workspace identity and effective knowledge policy digest are captured with that packet. Advice is saved as agent evidence; ledger skipped questions include the returned evidence. Gate A, Gate C and SHIP are always shadow escalation via `ff decide --gate GATE_A|GATE_C|SHIP <id>`; this command never creates approval receipts.

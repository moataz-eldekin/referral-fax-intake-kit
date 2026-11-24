# Eval results (2026-11-24 18:14 UTC)

| Fax | Fields | Queue | Urgency | M1 calls | Text to JSON | Cost | Time | Result |
|---|---|---|---|---|---|---|---|---|
| 01-cardiology-urgent-missing-id | 11/11 | needs_info | urgent | 2 | 1 | $0.054 | 8.4 s | PASS |
| 02-endocrinology-needs-labs | 6/6 | needs_info | routine | 2 | 1 | $0.054 | 7.4 s | PASS |
| 03-neurology-handwritten-asap | 6/6 | review | urgent | 1 | 1 | $0.053 | 7.4 s | PASS |
| 04-cardiology-resent-duplicate | 5/5 | review | urgent | 1 | 1 | $0.053 | 8.5 s | PASS |
| 05-endocrinology-existing-patient | 6/6 | review | routine | 1 | 1 | $0.053 | 8.5 s | PASS |
| 06-pharmacy-refill-request | 0/0 | other | routine | 1 | 0 | $0.002 | 2.1 s | PASS |
| 07-neurology-bad-npi-missing-page | 6/6 | needs_info | routine | 2 | 1 | $0.054 | 9.5 s | PASS |
| 08-cardiology-injection-chest-pain | 6/6 | review | urgent | 1 | 1 | $0.053 | 7.4 s | PASS |

8/8 faxes pass. Field accuracy 46/46 (100%). Urgent referrals marked routine: 0. Wrong values marked found: 0. Average cost $0.047 per fax, average time 7.4 s.

The same team wrote the sample faxes and the rules, so this is a smoke test, not clinical validation.

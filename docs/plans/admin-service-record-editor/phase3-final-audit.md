Model: gpt-5.6-sol | Effort: high

FINAL_VERDICT: SHIP

At `61a672cab`, the new envelope conjunct accepts explicit `requiredSessionCount: null` while rejecting omitted values and every invalid non-null value normalized to `null`. The six regression cases cover `undefined`, string, zero, negative, fractional, and `NaN`; valid blocked previews retain only the server blocker, while malformed counts also receive `INVALID_PREVIEW_RESPONSE`. Supplied GREEN result: 15/15; not rerun per instruction.


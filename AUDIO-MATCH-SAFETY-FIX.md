# Audio-device matching safety fix

- Unknown/missing brand data is now treated as unknown (0 brand evidence), not a perfect brand match.
- When both reports are classified as the headphone/audio family but image object confidence is sharply asymmetric (one below 45%, the other at least 75%), the candidate is capped at 59% and marked for manual review. This avoids a high score being driven by color, location, and generic text when the image evidence is inconsistent.
- This is a conservative review gate, not a claim that the model can always distinguish every earbud/headphone subtype. Admins must compare original images before confirming.
- Regression tests added in `tests/audio-device-mismatch-safety.test.js`.

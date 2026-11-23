# Hogwarts hairline v2

- Targets: the 18 character directories with `sd_samples/cg/hogwarts/*/hairline_v1.webp`.
- Source: each character's `hairline_v1.webp`; originals are retained.
- Edit tool: built-in ImageGen, one edit per character, no transparent background.
- Edit instruction: retain identity, age appearance, hair, crop, hands, background, lighting and cinematic semi-realistic style; add natural rosy cheek blush, subtle perspiration at hairline and temples, slightly upward gaze, a small glint of pooled tears at the lower eyelids and gently knit brows. No tear streaks, extra person, text or composition change.
- Delivery: `hairline_v2.webp` in the same character folder, converted from generated PNG with Pillow WebP quality 95, method 6.
- Validation: all 18 files passed Pillow decode verification. Visual review is reserved for the user by request.

Malfoy's v2 and v3 were superseded after the user identified the source hairline as incorrect. `malfoy/hairline_v4.webp` uses the old close-up for camera framing and the deployed Malfoy normal portrait as the authoritative face, hair color, part and hairline reference. The game uses v4 for Malfoy; the other 17 actors still use v2. The discarded v3 and resting v5 experiments are not connected to the game.

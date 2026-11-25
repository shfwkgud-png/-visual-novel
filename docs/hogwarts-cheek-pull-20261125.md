# Hogwarts cheek pull CG, 2026-11-25

## Placement

The new `actor/cheek_pull` CG is a separate fully clothed still. Its intended story order is `actor/hair_tie` → `actor/cheek_pull` → `actor/hairline`. `actor/resting` remains a separate pre-bed scene. `visuals.cgMoment` for the new still is `after_hair_tie`; the existing CG guard also requires the actor to be present and the player scene to be mutual. The story model chooses the moment; the rendering code validates the choice but does not maintain a strict scene history.

## Assets

All 18 actors listed in `storypacks/hogwarts-au/art.js` have `sd_samples/cg/hogwarts/<actor>/cheek_pull_v1.webp`. The original generated PNGs are retained under `C:/Users/user/Documents/PANDORA_gen/studio-output/runs/20261125-cheek-pull-18/`. These are new files; existing `hair_tie`, `resting`, and `hairline` files were preserved.

## Image recipe

Generated with the built-in Codex image generator, one image per actor. Each prompt used that actor's `hair_tie_v1.webp` as the primary identity, costume, room, and high camera reference; the actor's normal portrait as a secondary face reference; and Malfoy V18 (`C:/Users/user/Documents/PANDORA_gen/studio-output/hairline-lowerface-text-only/malfoy-v18-v16-cheek-pull.png`) for hand gesture only. The shared instruction was: one adult character, fully clothed, seated and viewed from above, one hand gently pulling a cheek sideways while the other points toward the mouth, moderately open mouth with natural teeth and tongue, relaxed direct gaze, same character/wardrobe/rug and understated cinematic rendering, no extra person or typography. The image generator did not expose a seed, model checkpoint, or LoRA weights. Malfoy's final is the user-approved V23 (`malfoy-v23-relaxed-gaze-natural-cheek.png`) instead of another generated variant. Final WebP conversion used Pillow quality 90, method 6.

On 2026-11-25, Malfoy `cheek_pull_v2.webp` replaced V1 in the active game at the user's request. The final PNG is `C:/Users/user/Documents/PANDORA_gen/studio-output/runs/20261125-cheek-pull-18/malfoy_cheek_pull_pupils_center_v2.png`. It was generated with built-in Codex image editing from the published Malfoy `cheek_pull_v1.webp` using this instruction: center both gray-green irises and pupils for direct camera eye contact while retaining the original eye shape, expression, identity and composition. The generator re-rendered some areas beyond the eyes; this result was explicitly accepted by the user. The original V1 asset remains on disk. The image generator did not expose a seed, checkpoint or LoRA weights for this edit.

Later on 2026-11-25, the user selected `C:/Users/user/.codex/generated_images/01a1e312-ba54-7f43-a86d-2ec2f88dec8a/exec-2af110a6-a0d5-4d07-9f43-c551d3e9b8de.png` as the new Malfoy image. The archived source is `C:/Users/user/Documents/PANDORA_gen/studio-output/runs/20261125-cheek-pull-18/malfoy_cheek_pull_user_selected_v3.png`, and the game uses `malfoy/cheek_pull_v3.webp`. V1 and V2 remain on disk for rollback. The attached image's generating prompt, seed, checkpoint, and LoRA weights were not available in this turn.

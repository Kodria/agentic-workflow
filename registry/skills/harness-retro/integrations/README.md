# harness-retro integrations

Records of the patches applied to the four cross-cutting AWM skills to wire in `harness-retro`. Each `<name>.md` documents one integration:

- **Target** — file path in `registry/skills/` (committed to the AWM repo)
- **Anchor** — existing text the patch attaches to
- **Insert** — exact text that was added, including the `<!-- AWM-INTEGRATION: ... -->` marker
- **Verify** — grep command that returns 1 if the integration is present

## How these patches are delivered

The modifications live directly in `registry/skills/<name>/SKILL.md` (committed to the AWM repo). Users receive them when they run `awm update` or reinstall. These docs are the historical record of what changed and why — not a manual application script.

## How to verify

Run the Verify command from each doc against the registry file. A result of `1` means the integration is applied; `0` means the registry file is missing the integration (which would be a regression — fix it with `Edit`).

## If an upstream skill update wipes the integration

1. Read the relevant `<name>.md` patch doc
2. Locate the anchor in the updated file
3. Apply the Insert with `Edit`
4. Verify with the Verify grep
5. Commit the fix as `fix(skills): restore harness-retro integration for <name>`

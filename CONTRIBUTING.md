# Contributing

Thanks for considering a contribution. This repository holds the **`awm` CLI**
and the framework documentation. The content it delivers — skills, bundles,
workflows, sensor packs — lives in
[Kodria/awm-baseline-registry](https://github.com/Kodria/awm-baseline-registry).
Changes to a skill belong there, not here.

## Licensing of contributions

This project is licensed under the [Apache License 2.0](LICENSE). Section 5 of
that licence already makes every contribution inbound = outbound: unless you
state otherwise, what you submit is submitted under these same terms. There is
nothing extra to sign for the licence to apply.

**The pull request is the certification.** By opening one you state that you
have the right to submit its contents under this licence — whether you typed
the commits yourself or an agent produced them on your behalf. We deliberately
do not require a per-commit `Signed-off-by` line: in an agent-delegated
workflow the commit author is a tool, and a certification signed by a tool
certifies nothing. The human act is opening and merging the pull request, so
that is where the statement belongs. (A tool that builds agent-delegated
workflows should not ship a contribution policy its own workflow cannot
satisfy.)

If you are contributing in the course of employment, confirm first that you are
permitted to do so — the copyright in work made during employment often belongs
to the employer, regardless of who or what wrote the commit.

### If you are not the project owner

The project owner can relicense this work only while they hold copyright in all
of it. That remains true today. **The first merged contribution from anyone
else ends it**, unless a contributor licence agreement granting the right to
relicense is in place *before* that pull request is merged.

So the rule is a trigger, not a plan: no CLA is needed while the owner is the
sole contributor. The moment a third-party pull request is worth merging, the
CLA decision is taken before the merge button, not after.

## Before you open a pull request

Read [`CONSTITUTION.md`](CONSTITUTION.md) — the non-negotiable rules (written
in Spanish) — and [`docs/decisions.md`](docs/decisions.md), which records why
things are the way they are. A proposal that reopens a decision listed there
should say which one and why.

### Run the same checks CI runs

CI builds and runs the full suite on **Linux, macOS, and Windows**, because the
CLI ships to all three and platform regressions have only ever surfaced there.
Locally, at minimum:

```bash
cd cli
npm run typecheck
npm run lint
npm test
```

Path handling, shell quoting, and symlink behaviour are the recurring sources
of platform-specific breakage. If your change touches any of them, say so in
the pull request so reviewers look at the Windows job.

### Title the pull request as a conventional commit

`release.yml` derives the published version from the conventional-commit prefix
on merge to `main`: `feat` → minor, `fix` → patch, `!` or `BREAKING CHANGE` →
major. Publication to npm happens automatically from that. A title without a
prefix produces a `patch` release regardless of what the change actually does.

### Tests are the contract, not a formality

A new automated check is finished when you have broken what it protects on
purpose and watched it fail with the right message — a green gate has two
possible causes, and only one of them is good news. New behaviour arrives with
the test that would fail without it.

## Reporting problems

- Bugs and proposals: open an issue.
- Security vulnerabilities: **do not** open a public issue. Follow
  [`SECURITY.md`](SECURITY.md).

## Trademark

Apache-2.0 §6 grants no trademark rights. The name "AWM" and the Kodria name
and marks are not part of the software licence: a fork is free to exist, and
free to use the code, but not to present itself as AWM.

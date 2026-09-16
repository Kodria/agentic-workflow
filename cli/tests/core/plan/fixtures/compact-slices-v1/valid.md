**Modo de ejecución:** desatendido

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "canonical-v1-corpus",
  "requirements": ["RF-1.3"],
  "sources": [{"id":"SRC-CORPUS","path":"source.md","locator":"## Canonical source","fact":"intentionally small and stable"}],
  "commands": [{"id":"CMD-TEST","program":"npm","args":["test"],"covers":["RF-1.3"]}],
  "slices": [{"id":"S1","title":"Canonical corpus","requirements":["RF-1.3"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-CORPUS"],"redCommands":["CMD-TEST"],"greenCommands":["CMD-TEST"],"reviewEvidence":["specification","code-quality"],"risk":"bounded","fallback":["Use the explicit bounded fallback."]}],
  "closureCommands": ["CMD-TEST"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Canonical corpus

#### Surfaces

The corpus files are the only surfaces.

#### Implementation

Validate the canonical fixture without transformations.

#### Edge cases

Each adversarial companion has an explicit non-success verdict.

#### Evidence

The validator report is the evidence.

#### Fallback

Use the explicit bounded fallback.

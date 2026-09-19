**Modo de ejecución:** desatendido

<!-- AWM:COMPACT-SLICES:START v2 -->
{
  "schema": "compact-slices/v2",
  "planId": "canonical-v2-corpus",
  "requirements": ["RF-1.3","RF-1.4"],
  "sources": [{"id":"SRC-CORPUS","path":"source.md","locator":"## Canonical source","fact":"intentionally small and stable"}],
  "commands": [{"id":"CMD-TEST","program":"npm","args":["test"],"covers":["RF-1.3","RF-1.4"]}],
  "slices": [
    {"id":"S1","title":"Mechanical corpus","requirements":["RF-1.3"],"dependsOn":[],"sectionAnchor":"slice-s1","implementerProfile":"mechanical","sources":["SRC-CORPUS"],"redCommands":["CMD-TEST"],"greenCommands":["CMD-TEST"],"reviewEvidence":["specification","code-quality"],"risk":"bounded","fallback":["Use the explicit bounded fallback."]},
    {"id":"S2","title":"Integration corpus","requirements":["RF-1.4"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","implementerProfile":"integration","sources":["SRC-CORPUS"],"redCommands":["CMD-TEST"],"greenCommands":["CMD-TEST"],"reviewEvidence":["specification","code-quality"],"risk":"bounded","fallback":["Use the explicit bounded fallback."]}
  ],
  "closureCommands": ["CMD-TEST"]
}
<!-- AWM:COMPACT-SLICES:END v2 -->

<a id="slice-s1"></a>
### Slice S1: Mechanical corpus

#### Surfaces

The corpus files are the only surfaces.

#### Implementation

Validate the canonical v2 fixture without transformations.

#### Edge cases

A semantic profile never names a model or a vendor.

#### Evidence

The validator report is the evidence.

#### Fallback

Use the explicit bounded fallback.

<a id="slice-s2"></a>
### Slice S2: Integration corpus

#### Surfaces

The corpus files are the only surfaces.

#### Implementation

Validate the second semantic profile without transformations.

#### Edge cases

Profiles differ per slice and are never inferred from the role.

#### Evidence

The validator report is the evidence.

#### Fallback

Use the explicit bounded fallback.

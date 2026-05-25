#!/usr/bin/env bash
# Tests CONSTITUTION.md injection in registry/hooks/session-start
# Run with: bash cli/tests/hooks/test-session-start-constitution.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/../../../registry/hooks/session-start"

if [ ! -f "$HOOK" ]; then
    echo "ERROR: hook not found at $HOOK"
    exit 2
fi

PASS=0
FAIL=0

assert_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    if printf '%s' "$haystack" | grep -qF "$needle"; then
        echo "PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name"
        echo "  Expected to find: $needle"
        echo "  Got: $haystack" | head -c 500
        echo ""
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    if printf '%s' "$haystack" | grep -qF "$needle"; then
        echo "FAIL: $name"
        echo "  Expected NOT to find: $needle"
        FAIL=$((FAIL + 1))
    else
        echo "PASS: $name"
        PASS=$((PASS + 1))
    fi
}

# Setup: three isolated temp dirs
TMP_WITH=$(mktemp -d)
TMP_WITHOUT=$(mktemp -d)
TMP_EMPTY=$(mktemp -d)
cleanup() { rm -rf "$TMP_WITH" "$TMP_WITHOUT" "$TMP_EMPTY"; }
trap cleanup EXIT

# Test 1: CONSTITUTION.md present and non-empty
cat > "$TMP_WITH/CONSTITUTION.md" << 'CONSTITUTION'
# Project Constitution

## Testing
- TDD always: write the failing test first.
CONSTITUTION
OUTPUT_WITH=$(cd "$TMP_WITH" && AWM_HOOKS_ROOT="$TMP_WITH" bash "$HOOK")
assert_contains "with constitution: emits JSON" "$OUTPUT_WITH" "additionalContext"
assert_contains "with constitution: includes header" "$OUTPUT_WITH" "Project Constitution"
assert_contains "with constitution: includes content" "$OUTPUT_WITH" "TDD always"
assert_contains "with constitution: still includes AWM envelope" "$OUTPUT_WITH" "You have AWM"

# Test 2: CONSTITUTION.md absent — behavior unchanged
OUTPUT_WITHOUT=$(cd "$TMP_WITHOUT" && AWM_HOOKS_ROOT="$TMP_WITHOUT" bash "$HOOK")
assert_contains "without constitution: emits JSON" "$OUTPUT_WITHOUT" "additionalContext"
assert_not_contains "without constitution: no constitution header" "$OUTPUT_WITHOUT" "Project Constitution"
assert_contains "without constitution: still includes AWM envelope" "$OUTPUT_WITHOUT" "You have AWM"

# Test 3: CONSTITUTION.md exists but empty — treated as absent
touch "$TMP_EMPTY/CONSTITUTION.md"
OUTPUT_EMPTY=$(cd "$TMP_EMPTY" && AWM_HOOKS_ROOT="$TMP_EMPTY" bash "$HOOK")
assert_contains "empty constitution: emits JSON" "$OUTPUT_EMPTY" "additionalContext"
assert_not_contains "empty constitution: no constitution header" "$OUTPUT_EMPTY" "Project Constitution"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]

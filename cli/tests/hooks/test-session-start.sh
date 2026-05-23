#!/usr/bin/env bash
# Test harness for registry/hooks/session-start
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/../../../registry/hooks/session-start"

TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT

pass=0
fail=0
fail_messages=()

assert_json_valid() {
    local json="$1"
    local label="$2"
    if echo "$json" | python3 -c 'import sys, json; json.load(sys.stdin)' 2>/dev/null; then
        echo "  ✓ $label"
        pass=$((pass + 1))
    else
        echo "  ✗ $label"
        fail=$((fail + 1))
        fail_messages+=("$label — invalid JSON: $json")
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if echo "$haystack" | python3 -c "import sys, json; obj=json.load(sys.stdin); ctx=obj.get('hookSpecificOutput',{}).get('additionalContext',''); sys.exit(0 if '$needle' in ctx else 1)" 2>/dev/null; then
        echo "  ✓ $label"
        pass=$((pass + 1))
    else
        echo "  ✗ $label"
        fail=$((fail + 1))
        fail_messages+=("$label — decoded context did not contain: $needle")
    fi
}

echo "Test 1: Happy path (ASCII content)"
AWM_HOOKS_ROOT="$TMPDIR" SKILL_DIR="$TMPDIR"
printf 'hello world\n' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
assert_json_valid "$output" "produces valid JSON"
assert_contains "$output" "hello world" "decoded context contains skill body"

echo ""
echo "Test 2: Special characters (quotes, backslashes, newlines)"
printf '%s\n' 'has "quotes" and \backslashes and' 'multi-line' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
assert_json_valid "$output" "produces valid JSON with special chars"
assert_contains "$output" "quotes" "decoded context preserves quoted text"

echo ""
echo "Test 3: Missing using-awm.md (failure-safe)"
rm -f "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
exit_code=$?
assert_json_valid "$output" "still produces valid JSON when skill missing"
if [ "$exit_code" = "0" ]; then
    echo "  ✓ exits 0 (failure-safe)"
    pass=$((pass + 1))
else
    echo "  ✗ exit code was $exit_code, expected 0"
    fail=$((fail + 1))
fi

echo ""
echo "Test 4: Large skill (10KB)"
python3 -c "print('x' * 10000)" > "$SKILL_DIR/using-awm.md"
start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")
elapsed=$((end_ms - start_ms))
assert_json_valid "$output" "handles 10KB skill"
if [ "$elapsed" -lt 500 ]; then
    echo "  ✓ completed in ${elapsed}ms (<500ms)"
    pass=$((pass + 1))
else
    echo "  ✗ took ${elapsed}ms (slower than 500ms)"
    fail=$((fail + 1))
fi

echo ""
echo "Test 5: Output structure (hookSpecificOutput.additionalContext)"
printf 'content\n' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
if echo "$output" | python3 -c "import sys, json; obj=json.load(sys.stdin); assert 'hookSpecificOutput' in obj; assert obj['hookSpecificOutput']['hookEventName'] == 'SessionStart'; assert 'additionalContext' in obj['hookSpecificOutput']" 2>/dev/null; then
    echo "  ✓ JSON has expected Claude Code hook structure"
    pass=$((pass + 1))
else
    echo "  ✗ JSON missing expected structure"
    fail=$((fail + 1))
fi

echo ""
echo "================================"
echo "Results: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
    echo ""
    echo "Failures:"
    for msg in "${fail_messages[@]}"; do
        echo "  - $msg"
    done
    exit 1
fi

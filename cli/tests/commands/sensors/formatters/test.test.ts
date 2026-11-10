import { fingerprint } from '../../../../src/commands/sensors/baseline';
import {
    normalizeRule,
    relativizeTestFile,
    SUITE_FAILED_RULE,
} from '../../../../src/commands/sensors/formatters/test-identity';
import { parseJestJson } from '../../../../src/commands/sensors/formatters/test-jest';
import { parseJunitXml } from '../../../../src/commands/sensors/formatters/test-junit';
import { parseTestOutput } from '../../../../src/commands/sensors/formatters/test';

const ROOT = '/repo/pkg';

describe('parseTestOutput (legacy)', () => {
    it('keeps returning an empty array', () => {
        expect(parseTestOutput('anything')).toEqual([]);
    });
});

describe('normalizeRule (RF-2.4)', () => {
    it('strips ANSI, trims, and collapses internal whitespace', () => {
        expect(normalizeRule('  \u001b[31mfoo\u001b[0m   bar\tbaz  ')).toBe('foo bar baz');
    });
});

describe('relativizeTestFile (RF-2.2)', () => {
    it('relativizes absolute paths under root with posix separators', () => {
        expect(relativizeTestFile(ROOT, `${ROOT}/src/a.test.ts`)).toBe('src/a.test.ts');
    });

    it('keeps paths outside root as returned', () => {
        expect(relativizeTestFile(ROOT, '/other/x.test.ts')).toBe('/other/x.test.ts');
    });

    it('passes through already-relative paths', () => {
        expect(relativizeTestFile(ROOT, 'src/b.test.ts')).toBe('src/b.test.ts');
    });
});

describe('parseJestJson (RF-2.1–2.5, RF-2.7)', () => {
    it('emits one finding per failed assertion with file + rule; fingerprint uses sensor|file|rule', () => {
        const raw = JSON.stringify({
            numFailedTests: 1,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: `${ROOT}/src/math.test.ts`,
                    status: 'failed',
                    assertionResults: [
                        {
                            status: 'failed',
                            fullName: 'math adds',
                            title: 'adds',
                            ancestorTitles: ['math'],
                            failureMessages: ['expect(1).toBe(2)'],
                        },
                        {
                            status: 'passed',
                            fullName: 'math ok',
                            title: 'ok',
                            ancestorTitles: ['math'],
                        },
                        {
                            status: 'pending',
                            fullName: 'math todo later',
                            title: 'todo later',
                            ancestorTitles: ['math'],
                        },
                        {
                            status: 'skipped',
                            fullName: 'math skip',
                            title: 'skip',
                            ancestorTitles: ['math'],
                        },
                        {
                            status: 'todo',
                            fullName: 'math todo',
                            title: 'todo',
                            ancestorTitles: ['math'],
                        },
                        {
                            status: 'disabled',
                            fullName: 'math disabled',
                            title: 'disabled',
                            ancestorTitles: ['math'],
                        },
                    ],
                },
            ],
        });
        const { findings, explainsNonZeroExit } = parseJestJson(raw, ROOT);
        expect(findings).toHaveLength(1);
        expect(findings[0].file).toBe('src/math.test.ts');
        expect(findings[0].rule).toBe('math adds');
        expect(findings[0].message).toEqual(expect.any(String));
        expect(fingerprint('test', findings[0])).toBe(
            fingerprint('test', { file: 'src/math.test.ts', rule: 'math adds', message: 'ignored' }),
        );
        expect(explainsNonZeroExit).toBe(true);
    });

    it('builds rule from ancestorTitles › title when fullName is absent', () => {
        const raw = JSON.stringify({
            numFailedTests: 1,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'rel.test.ts',
                    status: 'failed',
                    assertionResults: [
                        {
                            status: 'failed',
                            title: 'works',
                            ancestorTitles: ['Suite', 'Nested'],
                        },
                    ],
                },
            ],
        });
        const { findings } = parseJestJson(raw, ROOT);
        expect(findings[0].rule).toBe('Suite › Nested › works');
        expect(findings[0].file).toBe('rel.test.ts');
    });

    it('emits <suite-failed> when suite failed with testExecError and no failed assertions', () => {
        const raw = JSON.stringify({
            numFailedTests: 0,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: `${ROOT}/boom.test.ts`,
                    status: 'failed',
                    testExecError: { message: 'SyntaxError' },
                    assertionResults: [{ status: 'passed', fullName: 'ok', title: 'ok', ancestorTitles: [] }],
                },
            ],
        });
        const { findings } = parseJestJson(raw, ROOT);
        expect(findings).toEqual([
            expect.objectContaining({
                file: 'boom.test.ts',
                rule: SUITE_FAILED_RULE,
            }),
        ]);
    });

    it('emits <suite-failed> when suite failed with failureMessage and no failed assertions', () => {
        const raw = JSON.stringify({
            numFailedTests: 0,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: `${ROOT}/suite.test.ts`,
                    status: 'failed',
                    failureMessage: 'beforeAll blew up',
                    assertionResults: [],
                },
            ],
        });
        const { findings } = parseJestJson(raw, ROOT);
        expect(findings[0].rule).toBe(SUITE_FAILED_RULE);
    });

    it('normalizes ANSI in rule before return (RF-2.4)', () => {
        const raw = JSON.stringify({
            numFailedTests: 1,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [
                        {
                            status: 'failed',
                            fullName: '\u001b[31mcolored\u001b[0m  name',
                            title: 'name',
                            ancestorTitles: [],
                        },
                    ],
                },
            ],
        });
        expect(parseJestJson(raw, ROOT).findings[0].rule).toBe('colored name');
    });

    it('returns empty findings and explainsNonZeroExit false for malformed JSON', () => {
        expect(parseJestJson('not-json', ROOT)).toEqual({ findings: [], explainsNonZeroExit: false });
    });

    it('returns empty findings and explainsNonZeroExit false for empty raw', () => {
        expect(parseJestJson('', ROOT)).toEqual({ findings: [], explainsNonZeroExit: false });
    });

    it('sets explainsNonZeroExit false when coverageMap is truthy including {}', () => {
        const base = {
            numFailedTests: 1,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [{ status: 'failed', fullName: 't', title: 't', ancestorTitles: [] }],
                },
            ],
        };
        expect(parseJestJson(JSON.stringify({ ...base, coverageMap: {} }), ROOT).explainsNonZeroExit).toBe(false);
        expect(parseJestJson(JSON.stringify({ ...base, coverageMap: { '/x': {} } }), ROOT).explainsNonZeroExit).toBe(false);
    });

    it('sets explainsNonZeroExit false when numRuntimeErrorTestSuites > 0', () => {
        const raw = JSON.stringify({
            numFailedTests: 0,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 1,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    testExecError: { message: 'boom' },
                    assertionResults: [],
                },
            ],
        });
        const result = parseJestJson(raw, ROOT);
        expect(result.findings).toHaveLength(1);
        expect(result.explainsNonZeroExit).toBe(false);
    });

    it('sets explainsNonZeroExit false when wasInterrupted', () => {
        const raw = JSON.stringify({
            numFailedTests: 1,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: true,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [{ status: 'failed', fullName: 't', title: 't', ancestorTitles: [] }],
                },
            ],
        });
        expect(parseJestJson(raw, ROOT).explainsNonZeroExit).toBe(false);
    });

    it('sets explainsNonZeroExit false when numFailedTests mismatches emitted assertion findings', () => {
        const raw = JSON.stringify({
            numFailedTests: 99,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [{ status: 'failed', fullName: 't', title: 't', ancestorTitles: [] }],
                },
            ],
        });
        expect(parseJestJson(raw, ROOT).explainsNonZeroExit).toBe(false);
    });

    it('sets explainsNonZeroExit false when numFailedTestSuites mismatches failed suites in detail', () => {
        // Header/detail suite-count diverge while numFailedTests matches assertion findings.
        // Deleting `numFailedTestSuites === failedSuitesInDetail` must make this fail (RF-1.10).
        const raw = JSON.stringify({
            numFailedTests: 1,
            numFailedTestSuites: 99,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [{ status: 'failed', fullName: 't', title: 't', ancestorTitles: [] }],
                },
            ],
        });
        expect(parseJestJson(raw, ROOT).explainsNonZeroExit).toBe(false);
    });

    it('allows duplicate fullNames as separate findings', () => {
        const raw = JSON.stringify({
            numFailedTests: 2,
            numFailedTestSuites: 1,
            numRuntimeErrorTestSuites: 0,
            wasInterrupted: false,
            testResults: [
                {
                    name: 'a.test.ts',
                    status: 'failed',
                    assertionResults: [
                        { status: 'failed', fullName: 'same', title: 'same', ancestorTitles: [] },
                        { status: 'failed', fullName: 'same', title: 'same', ancestorTitles: [] },
                    ],
                },
            ],
        });
        const { findings, explainsNonZeroExit } = parseJestJson(raw, ROOT);
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.rule === 'same')).toBe(true);
        expect(explainsNonZeroExit).toBe(true);
    });
});

describe('parseJunitXml (RF-2.1–2.3, RF-2.6–2.7)', () => {
    it('emits a finding per testcase with failure or error; skips skipped-only', () => {
        const raw = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="s" tests="4" failures="1" errors="1" skipped="1" file="${ROOT}/t.test.ts">
    <testcase classname="Math" name="adds" file="${ROOT}/t.test.ts"><failure message="boom">stack</failure></testcase>
    <testcase classname="Math" name="errs" file="${ROOT}/t.test.ts"><error message="e">stack</error></testcase>
    <testcase classname="Math" name="skip" file="${ROOT}/t.test.ts"><skipped/></testcase>
    <testcase classname="Math" name="ok" file="${ROOT}/t.test.ts"/>
  </testsuite>
</testsuites>`;
        const { findings, explainsNonZeroExit } = parseJunitXml(raw, ROOT);
        expect(findings).toHaveLength(2);
        expect(findings[0]).toEqual(expect.objectContaining({ file: 't.test.ts', rule: 'Math › adds' }));
        expect(findings[1]).toEqual(expect.objectContaining({ file: 't.test.ts', rule: 'Math › errs' }));
        expect(explainsNonZeroExit).toBe(true);
    });

    it('uses only name when classname is empty', () => {
        const raw = `<testsuite name="s" failures="1" errors="0">
  <testcase classname="" name="lonely" file="x.test.ts"><failure/></testcase>
</testsuite>`;
        expect(parseJunitXml(raw, ROOT).findings[0].rule).toBe('lonely');
    });

    it('falls back to testsuite file when testcase has no file; empty when neither', () => {
        const withSuite = `<testsuite name="s" file="suite-only.test.ts" failures="1" errors="0">
  <testcase classname="C" name="n"><failure/></testcase>
</testsuite>`;
        expect(parseJunitXml(withSuite, ROOT).findings[0].file).toBe('suite-only.test.ts');

        const neither = `<testsuite name="s" failures="1" errors="0">
  <testcase classname="pkg.Class" name="n"><failure/></testcase>
</testsuite>`;
        expect(parseJunitXml(neither, ROOT).findings[0].file).toBe('');
    });

    it('emits <suite-failed> for suite-level failure/error outside testcases', () => {
        const raw = `<testsuite name="s" file="s.test.ts" failures="1" errors="0">
  <failure message="suite blew"/>
</testsuite>`;
        const { findings } = parseJunitXml(raw, ROOT);
        expect(findings).toEqual([
            expect.objectContaining({ file: 's.test.ts', rule: SUITE_FAILED_RULE }),
        ]);
    });

    it('emits <suite-failed> when suite reports failures/errors > 0 with no failed testcase children', () => {
        const raw = `<testsuite name="s" file="s.test.ts" failures="2" errors="0">
  <testcase classname="C" name="ok"/>
</testsuite>`;
        const { findings } = parseJunitXml(raw, ROOT);
        expect(findings).toHaveLength(1);
        expect(findings[0].rule).toBe(SUITE_FAILED_RULE);
    });

    it('treats testcase with both failure and skipped as failed', () => {
        const raw = `<testsuite name="s" failures="1" errors="0">
  <testcase classname="C" name="flaky" file="f.test.ts"><skipped/><failure message="x"/></testcase>
</testsuite>`;
        const { findings } = parseJunitXml(raw, ROOT);
        expect(findings).toHaveLength(1);
        expect(findings[0].rule).toBe('C › flaky');
    });

    it('sets explainsNonZeroExit true when suite errors+failures sum equals findings.length', () => {
        const raw = `<testsuite name="s" failures="1" errors="1">
  <testcase classname="C" name="a" file="a.ts"><failure/></testcase>
  <testcase classname="C" name="b" file="a.ts"><error/></testcase>
</testsuite>`;
        expect(parseJunitXml(raw, ROOT).explainsNonZeroExit).toBe(true);
    });

    it('sets explainsNonZeroExit false when suite errors+failures sum mismatches findings.length', () => {
        const raw = `<testsuite name="s" failures="5" errors="0">
  <testcase classname="C" name="a" file="a.ts"><failure/></testcase>
</testsuite>`;
        const result = parseJunitXml(raw, ROOT);
        // one failed testcase finding; attrs say 5 → mismatch (no suite-failed because a failed child exists)
        expect(result.findings).toHaveLength(1);
        expect(result.explainsNonZeroExit).toBe(false);
    });

    it('returns empty findings and explainsNonZeroExit false for malformed / doctype / entity expansion', () => {
        expect(parseJunitXml('not xml', ROOT)).toEqual({ findings: [], explainsNonZeroExit: false });
        expect(parseJunitXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>', ROOT)).toEqual({
            findings: [],
            explainsNonZeroExit: false,
        });
        expect(parseJunitXml('', ROOT)).toEqual({ findings: [], explainsNonZeroExit: false });
    });

    it('normalizes ANSI in JUnit rule', () => {
        const raw = `<testsuite name="s" failures="1" errors="0">
  <testcase classname="C" name="\u001b[32mx\u001b[0m  y" file="a.ts"><failure/></testcase>
</testsuite>`;
        expect(parseJunitXml(raw, ROOT).findings[0].rule).toBe('C › x y');
    });

    it('accepts failure body wrapped in CDATA and still explains when counts match', () => {
        const raw = `<testsuite name="s" failures="1" errors="0">
  <testcase classname="C" name="cdata" file="c.test.ts"><failure message="boom"><![CDATA[expect(1).toBe(2)
& not an entity]]></failure></testcase>
</testsuite>`;
        const { findings, explainsNonZeroExit } = parseJunitXml(raw, ROOT);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toEqual(expect.objectContaining({ file: 'c.test.ts', rule: 'C › cdata' }));
        expect(explainsNonZeroExit).toBe(true);
    });
});

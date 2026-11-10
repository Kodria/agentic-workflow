import {
    emptyParseResult,
    finding,
    relativizeTestFile,
    SUITE_FAILED_RULE,
    TestParseResult,
} from './test-identity';

type JestAssertion = {
    status?: string;
    fullName?: string;
    title?: string;
    ancestorTitles?: string[];
};

type JestTestResult = {
    name?: string;
    status?: string;
    testExecError?: unknown;
    failureMessage?: string | null;
    assertionResults?: JestAssertion[];
};

type JestJson = {
    numFailedTests?: number;
    numFailedTestSuites?: number;
    numRuntimeErrorTestSuites?: number;
    wasInterrupted?: boolean;
    coverageMap?: unknown;
    testResults?: JestTestResult[];
};

function assertionRule(a: JestAssertion): string {
    if (typeof a.fullName === 'string' && a.fullName.length > 0) return a.fullName;
    const ancestors = Array.isArray(a.ancestorTitles) ? a.ancestorTitles.filter((t) => typeof t === 'string') : [];
    const title = typeof a.title === 'string' ? a.title : '';
    return [...ancestors, title].filter(Boolean).join(' › ');
}

export function parseJestJson(raw: string, root: string): TestParseResult {
    if (!raw || !raw.trim()) return emptyParseResult();
    let obj: JestJson;
    try {
        obj = JSON.parse(raw);
    } catch {
        return emptyParseResult();
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return emptyParseResult();

    const findings: TestParseResult['findings'] = [];
    const suites = Array.isArray(obj.testResults) ? obj.testResults : [];
    let assertionFindingCount = 0;
    let failedSuitesInDetail = 0;

    for (const suite of suites) {
        if (!suite || typeof suite !== 'object') continue;
        const file = relativizeTestFile(root, typeof suite.name === 'string' ? suite.name : '');
        const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
        let failedAssertions = 0;
        for (const a of assertions) {
            if (!a || typeof a !== 'object') continue;
            if (a.status !== 'failed') continue;
            findings.push(finding(file, assertionRule(a)));
            failedAssertions += 1;
            assertionFindingCount += 1;
        }
        if (suite.status === 'failed') {
            failedSuitesInDetail += 1;
            const hasExecOrMessage = suite.testExecError != null
                || (typeof suite.failureMessage === 'string' && suite.failureMessage.length > 0);
            if (hasExecOrMessage && failedAssertions === 0) {
                findings.push(finding(file, SUITE_FAILED_RULE));
            }
        }
    }

    // Truthy coverageMap (including `{}`) → unexplained (fail-closed).
    const explainsNonZeroExit = !obj.coverageMap
        && (obj.numRuntimeErrorTestSuites ?? 0) === 0
        && !obj.wasInterrupted
        && (obj.numFailedTests ?? 0) === assertionFindingCount
        && (obj.numFailedTestSuites ?? 0) === failedSuitesInDetail;

    return { findings, explainsNonZeroExit };
}

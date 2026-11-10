import {
    emptyParseResult,
    finding,
    relativizeTestFile,
    SUITE_FAILED_RULE,
    TestParseResult,
} from './test-identity';

type Attrs = Record<string, string>;

type XmlNode = {
    name: string;
    attrs: Attrs;
    children: XmlNode[];
    text: string;
};

function decodeAttr(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Attrs | null {
    const attrs: Attrs = {};
    const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    const trimmed = raw.trim();
    if (!trimmed) return attrs;
    while ((m = re.exec(trimmed))) {
        attrs[m[1]] = decodeAttr(m[2] ?? m[3] ?? '');
        consumed = re.lastIndex;
    }
    // Refuse leftover tokens (entity refs in attr names, unquoted values, etc.)
    if (trimmed.slice(consumed).trim().length > 0) return null;
    return attrs;
}

/**
 * Minimal element tree parser. Refuses DOCTYPE / entity expansion (malformed).
 * CDATA is treated as ordinary text (not entity expansion). Other `<!` forms fail closed.
 */
function parseXml(raw: string): XmlNode | null {
    if (!raw || !raw.trim()) return null;
    if (/<!DOCTYPE/i.test(raw) || /<!ENTITY/i.test(raw)) return null;

    const rootChildren: XmlNode[] = [];
    const stack: XmlNode[] = [];
    let i = 0;
    const s = raw;

    const pushChild = (node: XmlNode): void => {
        if (stack.length === 0) rootChildren.push(node);
        else stack[stack.length - 1].children.push(node);
    };

    while (i < s.length) {
        const lt = s.indexOf('<', i);
        if (lt < 0) break;
        if (stack.length > 0 && lt > i) {
            stack[stack.length - 1].text += s.slice(i, lt);
        }
        if (s.startsWith('<?', lt)) {
            const end = s.indexOf('?>', lt);
            if (end < 0) return null;
            i = end + 2;
            continue;
        }
        if (s.startsWith('<!--', lt)) {
            const end = s.indexOf('-->', lt);
            if (end < 0) return null;
            i = end + 3;
            continue;
        }
        if (s.startsWith('<![CDATA[', lt)) {
            const end = s.indexOf(']]>', lt + 9);
            if (end < 0) return null;
            if (stack.length > 0) {
                stack[stack.length - 1].text += s.slice(lt + 9, end);
            }
            i = end + 3;
            continue;
        }
        if (s.startsWith('<!', lt)) {
            // DOCTYPE / ENTITY / unknown declaration — refuse (fail closed)
            return null;
        }
        if (s.startsWith('</', lt)) {
            const end = s.indexOf('>', lt);
            if (end < 0 || stack.length === 0) return null;
            const closeName = s.slice(lt + 2, end).trim();
            const open = stack.pop()!;
            if (open.name !== closeName) return null;
            pushChild(open);
            i = end + 1;
            continue;
        }
        const end = s.indexOf('>', lt);
        if (end < 0) return null;
        let body = s.slice(lt + 1, end).trim();
        const selfClosing = body.endsWith('/');
        if (selfClosing) body = body.slice(0, -1).trim();
        const sp = body.search(/\s/);
        const name = (sp < 0 ? body : body.slice(0, sp)).trim();
        if (!/^[A-Za-z_][\w:.-]*$/.test(name)) return null;
        const attrRaw = sp < 0 ? '' : body.slice(sp);
        const attrs = parseAttrs(attrRaw);
        if (!attrs) return null;
        const node: XmlNode = { name, attrs, children: [], text: '' };
        if (selfClosing) pushChild(node);
        else stack.push(node);
        i = end + 1;
    }
    if (stack.length !== 0) return null;
    if (rootChildren.length === 0) return null;
    // Prefer a single document element; if multiple, wrap virtually under testsuites-like walk.
    if (rootChildren.length === 1) return rootChildren[0];
    return { name: '#root', attrs: {}, children: rootChildren, text: '' };
}

function intAttr(attrs: Attrs, key: string): number {
    const v = attrs[key];
    if (v == null || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function walkSuites(node: XmlNode, out: XmlNode[]): void {
    if (node.name === 'testsuite') out.push(node);
    for (const child of node.children) walkSuites(child, out);
}

function testcaseRule(attrs: Attrs): string {
    const name = attrs.name ?? '';
    const classname = attrs.classname ?? '';
    if (!classname) return name;
    return `${classname} › ${name}`;
}

function hasChild(node: XmlNode, tag: string): boolean {
    return node.children.some((c) => c.name === tag);
}

export function parseJunitXml(raw: string, root: string): TestParseResult {
    const doc = parseXml(raw);
    if (!doc) return emptyParseResult();

    const suites: XmlNode[] = [];
    walkSuites(doc, suites);
    if (suites.length === 0) return emptyParseResult();

    const findings: TestParseResult['findings'] = [];
    let attrSum = 0;

    for (const suite of suites) {
        const failures = intAttr(suite.attrs, 'failures');
        const errors = intAttr(suite.attrs, 'errors');
        attrSum += failures + errors;

        const suiteFileRaw = suite.attrs.file ?? '';
        const suiteFile = suiteFileRaw ? relativizeTestFile(root, suiteFileRaw) : '';

        const testcases = suite.children.filter((c) => c.name === 'testcase');
        let failedCaseCount = 0;

        for (const tc of testcases) {
            const failed = hasChild(tc, 'failure') || hasChild(tc, 'error');
            if (!failed) continue;
            failedCaseCount += 1;
            const fileRaw = tc.attrs.file || suiteFileRaw;
            const file = fileRaw ? relativizeTestFile(root, fileRaw) : '';
            findings.push(finding(file, testcaseRule(tc.attrs)));
        }

        // Suite-level failure/error nodes are direct children (outside testcases).
        const directSuiteFault = suite.children.some(
            (c) => c.name === 'failure' || c.name === 'error',
        );

        if (directSuiteFault || ((failures > 0 || errors > 0) && failedCaseCount === 0)) {
            // One suite-failed finding (RF-2.6), even when attrs count > 1.
            findings.push(finding(suiteFile, SUITE_FAILED_RULE));
        }
    }

    const explainsNonZeroExit = attrSum === findings.length;
    return { findings, explainsNonZeroExit };
}

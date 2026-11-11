const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '../..');

function execute(command, args, options = {}) {
    return new Promise(resolve => {
        const child = spawn(command, args, { windowsHide: true, ...options });
        let stdout = '', stderr = '', timedOut = false;
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout || 30000);
        child.on('error', error => { stderr += error.message; });
        child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    });
}

async function scanScenario(directory, scenario) {
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['dependencies.json', 'projects.json', 'scan.xlsx', 'scan-summary.json']) {
        const file = path.join(directory, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/validation-scan/repositories.json'), 'utf8'));
    const calls = [];
    const unexpected = [];
    const repos = scenario.repositories || ['npm'];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const route = decodeURIComponent(url.pathname);
        calls.push({ path: route, page: url.searchParams.get('page'), ref: url.searchParams.get('ref') });
        const send = (code, body) => {
            res.writeHead(code, { 'Content-Type': 'application/json', 'x-github-request-id': 'validation-local' });
            res.end(JSON.stringify(body));
        };
        const meta = name => ({ name, default_branch: 'main', owner: { login: 'validation', type: 'Organization' }, fork: name === 'fork', archived: false });
        if (route === '/orgs/validation/repos') {
            if (scenario.discoveryStatus) return send(scenario.discoveryStatus, { message: 'Simulated discovery error' });
            if (scenario.pagination && !url.searchParams.has('page')) {
                res.setHeader('Link', `<http://127.0.0.1:${server.address().port}/orgs/validation/repos?page=2>; rel="next"`);
                return send(200, repos.slice(0, 1).map(meta));
            }
            return send(200, (scenario.pagination ? repos.slice(1) : repos).map(meta));
        }
        const match = route.match(/^\/repos\/validation\/([^/]+)\/(.*)$/);
        if (match) {
            const [, repo, tail] = match;
            if (scenario.failedRepo === repo) return send(403, { message: 'Simulated repository error' });
            const files = fixture[repo] || fixture.npm;
            if (tail === 'branches') return send(404, { message: 'Empty branch supplied by scanner' });
            if (tail.startsWith('branches/')) {
                const branch = tail.slice('branches/'.length);
                if (!['main', 'release-test'].includes(branch)) return send(404, { message: 'Unknown branch' });
                return send(200, { name: branch, commit: { sha: branch === 'main' ? 'a'.repeat(40) : 'b'.repeat(40) } });
            }
            if (tail.startsWith('git/trees/')) return send(200, { tree: Object.keys(files).map(file => ({ path: file, type: 'blob' })), truncated: false });
            if (tail.startsWith('contents/')) {
                const file = tail.slice('contents/'.length);
                if (!(file in files)) return send(404, { message: 'Missing file' });
                let content = typeof files[file] === 'string' ? files[file] : JSON.stringify(files[file]);
                if (url.searchParams.get('ref') === 'b'.repeat(40)) content = content.replaceAll('18.2.0', '19.0.0');
                return send(200, { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') });
            }
        }
        unexpected.push(route);
        send(404, { message: 'Unexpected fixture route' });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    // Remove every scanner setting inherited from the terminal; never load the user's .env.
    const env = { ...process.env };
    const scanner = fs.readFileSync(path.join(root, 'src/scan-ghe.js'), 'utf8');
    for (const match of scanner.matchAll(/process\.env\.([A-Z_]+)/g)) delete env[match[1]];
    Object.assign(env, {
        GHE_BASE_URL: `http://127.0.0.1:${server.address().port}`, GHE_TOKEN: 'validation-fake-token',
        START_ORGS: 'validation', INCLUDE_USER_REPOS: 'false', PREFILTER_MODE: 'off',
        INCLUDE_DEPENDENCIES: 'true', LIBS_MATCH_SCOPE: 'dependencies', OUTPUT_DIR: directory,
        OUTPUT_JSON_ENABLED: 'true', OUTPUT_XLSX_ENABLED: 'true',
        INCLUDE_ONLY_LIBS: scenario.libs || '', EXCLUDE_DIRS: scenario.excludeDirs || '',
    });
    if (scenario.branch !== null) env.SCAN_BRANCH = scenario.branch ?? 'main';
    if (scenario.preserve) {
        const previousRow = { org: 'validation', repo: 'previous-complete', default_branch: 'main',
            package_path: '.', package_name: 'previous-app', dependency: 'react', declared_range: '^17.0.2',
            resolved_version: '17.0.2', lock_source: 'npm-lock', commit_sha_scanned: 'c'.repeat(40) };
        fs.writeFileSync(path.join(directory, 'dependencies.json'), JSON.stringify([previousRow], null, 2));
        const previous = new ExcelJS.Workbook();
        const dependencies = previous.addWorksheet('Dependencies');
        dependencies.columns = Object.keys(previousRow).map(key => ({ header: key, key }));
        dependencies.addRow(previousRow);
        previous.addWorksheet('Projects').addRow(['org', 'repo', 'default_branch']);
        previous.getWorksheet('Projects').addRow(['validation', 'previous-complete', 'main']);
        await previous.xlsx.writeFile(path.join(directory, 'scan.xlsx'));
    }
    const previous = scenario.preserve ? fs.readFileSync(path.join(directory, 'dependencies.json'), 'utf8') : null;
    const previousExcel = scenario.preserve ? fs.readFileSync(path.join(directory, 'scan.xlsx')) : null;
    let execution;
    try {
        execution = await execute(process.execPath, [path.join(root, 'src/scan-ghe.js')], { cwd: directory, env, timeout: 20000 });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    fs.writeFileSync(path.join(directory, 'terminal.txt'), execution.stdout + '\n' + execution.stderr);
    fs.writeFileSync(path.join(directory, 'api-calls.json'), JSON.stringify(calls, null, 2));
    const json = name => fs.existsSync(path.join(directory, name)) ? JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) : [];
    const dependencies = json('dependencies.json');
    const projects = json('projects.json');
    let excel = [], excelProjects = [];
    if (fs.existsSync(path.join(directory, 'scan.xlsx'))) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(path.join(directory, 'scan.xlsx'));
        const rows = name => {
            const sheet = workbook.getWorksheet(name);
            if (!sheet) return [];
            const headers = sheet.getRow(1).values;
            const records = [];
            sheet.eachRow((row, index) => {
                if (index > 1) records.push(Object.fromEntries(headers.slice(1).map((header, i) => [header, row.getCell(i + 1).value])));
            });
            return records;
        };
        excel = rows('Dependencies');
        excelProjects = rows('Projects');
    }
    return {
        ...execution, dependencies, projects, excel, excelProjects, calls, unexpected,
        preserved: previous === null || (fs.readFileSync(path.join(directory, 'dependencies.json'), 'utf8') === previous
            && fs.readFileSync(path.join(directory, 'scan.xlsx')).equals(previousExcel)),
    };
}

module.exports = { execute, scanScenario, root };

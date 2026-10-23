/**
 * Renvoie la 1ère capture (groupe 1) trouvée par `re` dans `text`, sinon null.
 */
function firstGroupMatch(text, re) {
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[1]) return m[1].trim();
    }
    return null;
}

/**
 * Extrait la version du projet Gradle (Groovy/Kotlin DSL).
 * - Gère :
 *   a) version = "x"  |  version 'x'
 *   b) project.version = "x"  |  rootProject.version = 'x'
 *   c) setVersion("x")  |  setVersion 'x'
 * - Ignore les commentaires et le bloc dependencies { ... }.
 */
function extractGradleProjectVersion(buildScript) {
    if (!buildScript || typeof buildScript !== 'string') return null;

    // 1) Supprimer commentaires /* ... */ et // ...
    const withoutBlockComments = buildScript.replace(/\/\*[\s\S]*?\*\//g, '');
    const cleaned = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');

    // 2) Retirer le bloc dependencies { ... } (pour limiter les faux positifs)
    const s = cleaned.replace(/dependencies\s*\{[\s\S]*?\}\s*/g, '\n');

    // 3) Essayer plusieurs formes (chacune AVEC un groupe capturant)
    // a) version = "x" | version 'x'
    const a1 = firstGroupMatch(s, /^\s*version\s*=\s*["']([^"']+)["']\s*$/gm);
    if (a1) return a1;

    // a’) version "x" | version 'x' (DSL sans '=')
    const a2 = firstGroupMatch(s, /^\s*version\s*["']([^"']+)["']\s*$/gm);
    if (a2) return a2;

    // b) project.version = "x" | rootProject.version = 'x'
    const b1 = firstGroupMatch(s, /^\s*(?:project|rootProject)\s*\.\s*version\s*=\s*["']([^"']+)["']\s*$/gm);
    if (b1) return b1;

    // c) setVersion("x") | setVersion 'x'
    const c1 = firstGroupMatch(s, /^\s*setVersion\(\s*["']([^"']+)["']\)\s*$/gm);
    if (c1) return c1;

    const c2 = firstGroupMatch(s, /^\s*setVersion\s+["']([^"']+)["']\s*$/gm);
    if (c2) return c2;

    return null;
}

const samples = [
    'version = "1.2.3"\n',
    "version '2.0.0'\n",
    'project.version = "3.4.5"\n',
    "rootProject.version = '4.5.6'\n",
    'setVersion("5.6.7")\n',
    "setVersion '6.7.8'\n",
    `// avec commentaires
     /* bloc */
     dependencies { implementation("x:y:1.0.0") }
     version = "7.8.9"
    `
];

for (const s of samples) {
    console.log(extractGradleProjectVersion(s));
}
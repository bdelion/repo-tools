/**
 * Fonctions utilitaires pour filtrer les fichiers à inclure ou exclure.
 */

/**
 * Vérifie si un fichier doit être traité.
 * @param {string} filePath - Chemin du fichier
 * @returns {boolean} - true si le fichier est valide
 */
export function shouldProcessFile(filePath: string): boolean {
    const excludedPatterns = ['.spec.js', '.e2e.js', '.scss', '.md', '.svg', '/style/'];
    return !excludedPatterns.some(pattern => filePath.includes(pattern));
}

/**
 * Vérifie si un fichier est un fichier JSX/TSX/JS/TS.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isJSXFile(filePath: string): boolean {
    return /\.(jsx|tsx|js|ts)$/.test(filePath);
}

/**
 * Vérifie si le fichier est dans un dossier de hooks ou contextes.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isHooks(filePath: string): boolean {
    return /(hooks|contexts|internal)/.test(filePath);
}

/**
 * Vérifie si le fichier doit être exclu du graphe filtré.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isFilteredNode(filePath: string): boolean {
    const patterns = [
        /\.test\./, /\.spec\./, /__tests__/, /assets/, /styles/, /\.css$/, /\.scss$/, /\.less$/, /\.sass$/,
        /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.svg$/, /\.ico$/
    ];
    return patterns.some(pattern => pattern.test(filePath));
}

/**
 * Extrait les noms des imports depuis le contenu d'un fichier source.
 * Gère les cas suivants :
 * - import A from '...'
 * - import { A, B } from '...'
 * - import A, { B, C } from '...'
 * - import 'module' (ignoré car sans nom)
 *
 * @param {string} content - Contenu du fichier source
 * @returns {string[]} - Liste des noms importés
 */
export function extractImportNames(content: string): string[] {
    const imports: string[] = [];

    const importRegex = /^import\s+(?:type\s+)?([^;]+?)\s+from\s+['"][^'"]+['"];?$/gm;

    for (const match of content.matchAll(importRegex)) {
        const clause = match[1].trim();

        console.log("--- BEGIN ---");
        console.log(clause);
        console.log("--- END ---");

        const braceMatch = clause.match(/\{([\s\S]*?)\}/);
        console.log("--- BEGIN braceMatch ---");
        console.log(braceMatch);
        console.log("--- END braceMatch ---");

        if (braceMatch) {
            imports.push(
                ...braceMatch[1]
                    .split(",")
                    .map(x => x.trim())
                    .filter(Boolean)
                    .map(x => x.split(/\s+as\s+/)[0].trim())
            );
        }

        console.log("--- BEGIN braceMatch imports ---");
        console.log(imports);
        console.log("--- END braceMatch imports ---");

        const defaultPart = clause
            .replace(/\{[\s\S]*?\}/, "")
            .replace(",", "")
            .trim();

        console.log("--- BEGIN defaultPart ---");
        console.log(defaultPart);
        console.log("--- END defaultPart ---");
        if (defaultPart) {
            imports.push(defaultPart);
        }
        console.log("--- BEGIN defaultPart imports ---");
        console.log(imports);
        console.log("--- END defaultPart imports ---");
    }

    return [...new Set(imports)];
}
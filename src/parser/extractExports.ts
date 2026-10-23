/**
 * Extrait les noms des exports et les métadonnées `@visibleName` du contenu d’un fichier source.
 * Gère les cas :
 * - export const Component
 * - export default Component
 * - @visibleName [icone] Nom
 *
 * @param {string} content - Contenu du fichier source
 * @returns {Array<{ extractName: string, visibleName: string, icone: string }>}
 */
export function extractExportNames(content: string): Array<{ extractName: string, visibleName: string, icone: string }> {
    const exportRegex = /export\s+(?:(default|const|function|enum)\s+)?(\w+)/g;
    const visibleNameRegex = /@visibleName\s+([^\w]+)\s+(\w+)/g;

    const exports = [...content.matchAll(exportRegex)];
    const visibleNames = [...content.matchAll(visibleNameRegex)];

    const result = exports.map((exp, index) => {
        const extractName = exp[2];
        const visibleMatch = visibleNames.find(vm => vm[2] === extractName);

        return {
            extractName,
            visibleName: visibleMatch?.[2] ?? '',
            icone: visibleMatch?.[1] ?? ''
        };
    });

    return result;
}

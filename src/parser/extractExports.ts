import { sourceSyntax } from './sourceSyntax';

export function extractExportNames(content: string): Array<{ extractName: string; visibleName: string; icone: string }> {
    return sourceSyntax.parseSource(content, 'source.tsx').exports.filter(item => item.name !== '*').map(item => ({
        extractName: item.name,
        visibleName: item.name === 'default' ? item.local ?? 'default' : item.name,
        icone: item.icone ?? '',
    }));
}

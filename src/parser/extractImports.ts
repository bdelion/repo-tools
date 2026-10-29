import { sourceSyntax } from './sourceSyntax';

export function extractImportNames(content: string): string[] {
    return [...new Set(sourceSyntax.parseSource(content, 'source.tsx').imports.map(item =>
        item.imported === 'default' ? item.local : item.imported))];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Ordre naturel stable : Component2 précède Component10, y compris entre chemins. */
export function naturalCompare(a: string, b: string): number {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function libraryDisplayName(node: { name: string; publicNames: string[] }): string {
    return node.publicNames.includes(node.name) ? node.name : node.publicNames.find(name => name !== 'default') ?? node.name;
}

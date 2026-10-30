import { createRequire } from 'node:module';
export interface ImportSyntax { source: string; imported: string; local: string }
export interface ExportSyntax { name: string; local?: string; source?: string; imported?: string; icone?: string }
export const sourceSyntax: {
    parseSource(content: string, file: string): { imports: ImportSyntax[]; exports: ExportSyntax[] };
} = createRequire(__filename)('../sourceProject.cjs');

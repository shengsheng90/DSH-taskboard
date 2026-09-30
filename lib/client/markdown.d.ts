export type MarkdownInline = {
    readonly type: 'text';
    readonly value: string;
} | {
    readonly type: 'code';
    readonly value: string;
} | {
    readonly type: 'strong';
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'em';
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'del';
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'link';
    readonly href: string;
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'image';
    readonly src: string;
    readonly alt: string;
};
export type MarkdownBlock = {
    readonly type: 'paragraph';
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'heading';
    readonly level: 1 | 2 | 3 | 4;
    readonly children: readonly MarkdownInline[];
} | {
    readonly type: 'code';
    readonly language: string;
    readonly value: string;
} | {
    readonly type: 'blockquote';
    readonly children: readonly MarkdownBlock[];
} | {
    readonly type: 'list';
    readonly ordered: boolean;
    readonly items: readonly (readonly MarkdownInline[])[];
} | {
    readonly type: 'hr';
};
export type MarkdownEditAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol';
export interface MarkdownEditResult {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
}
/** Allow http(s), mailto, and Taskboard attachment content URLs; drop javascript/data/relative traps. */
export declare function sanitizeMarkdownUrl(raw: string): string | undefined;
export declare function parseMarkdown(source: string): MarkdownBlock[];
export declare function applyMarkdownEdit(value: string, selectionStart: number, selectionEnd: number, action: MarkdownEditAction): MarkdownEditResult;
export declare function parseInline(input: string): MarkdownInline[];
//# sourceMappingURL=markdown.d.ts.map
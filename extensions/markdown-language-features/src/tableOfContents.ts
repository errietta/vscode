/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogger } from './logging';
import { IMdParser } from './markdownEngine';
import { githubSlugifier, Slug, Slugifier } from './slugify';
import { Disposable } from './util/dispose';
import { isMarkdownFile } from './util/file';
import { MdDocumentInfoCache } from './util/workspaceCache';
import { MdWorkspaceContents, SkinnyTextDocument } from './workspaceContents';

export interface TocEntry {
	readonly slug: Slug;
	readonly text: string;
	readonly level: number;
	readonly line: number;

	/**
	 * The entire range of the header section.
	 *
	* For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * # Next head #
	 * ```
	 *
	 * This is the range from `# Head #` to `# Next head #`
	 */
	readonly sectionLocation: vscode.Location;

	/**
	 * The range of the header declaration.
	 *
	 * For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * ```
	 *
	 * This is the range of `# Head #`
	 */
	readonly headerLocation: vscode.Location;

	/**
	 * The range of the header text.
	 *
	 * For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * ```
	 *
	 * This is the range of `Head`
	 */
	readonly headerTextLocation: vscode.Location;
}

export class TableOfContents {

	public static async create(parser: IMdParser, document: SkinnyTextDocument,): Promise<TableOfContents> {
		const entries = await this.buildToc(parser, document);
		return new TableOfContents(entries, parser.slugifier);
	}

	public static async createForDocumentOrNotebook(parser: IMdParser, document: SkinnyTextDocument): Promise<TableOfContents> {
		if (document.uri.scheme === 'vscode-notebook-cell') {
			const notebook = vscode.workspace.notebookDocuments
				.find(notebook => notebook.getCells().some(cell => cell.document === document));

			if (notebook) {
				const entries: TocEntry[] = [];

				for (const cell of notebook.getCells()) {
					if (cell.kind === vscode.NotebookCellKind.Markup && isMarkdownFile(cell.document)) {
						entries.push(...(await this.buildToc(parser, cell.document)));
					}
				}

				return new TableOfContents(entries, parser.slugifier);
			}
		}

		return this.create(parser, document);
	}

	private static async buildToc(parser: IMdParser, document: SkinnyTextDocument): Promise<TocEntry[]> {
		const toc: TocEntry[] = [];
		const tokens = await parser.tokenize(document);

		const existingSlugEntries = new Map<string, { count: number }>();

		for (const heading of tokens.filter(token => token.type === 'heading_open')) {
			if (!heading.map) {
				continue;
			}

			const lineNumber = heading.map[0];
			const line = document.lineAt(lineNumber);

			let slug = parser.slugifier.fromHeading(line.text);
			const existingSlugEntry = existingSlugEntries.get(slug.value);
			if (existingSlugEntry) {
				++existingSlugEntry.count;
				slug = parser.slugifier.fromHeading(slug.value + '-' + existingSlugEntry.count);
			} else {
				existingSlugEntries.set(slug.value, { count: 0 });
			}

			const headerLocation = new vscode.Location(document.uri,
				new vscode.Range(lineNumber, 0, lineNumber, line.text.length));

			const headerTextLocation = new vscode.Location(document.uri,
				new vscode.Range(lineNumber, line.text.match(/^#+\s*/)?.[0].length ?? 0, lineNumber, line.text.length - (line.text.match(/\s*#*$/)?.[0].length ?? 0)));

			toc.push({
				slug,
				text: TableOfContents.getHeaderText(line.text),
				level: TableOfContents.getHeaderLevel(heading.markup),
				line: lineNumber,
				sectionLocation: headerLocation, // Populated in next steps
				headerLocation,
				headerTextLocation
			});
		}

		// Get full range of section
		return toc.map((entry, startIndex): TocEntry => {
			let end: number | undefined = undefined;
			for (let i = startIndex + 1; i < toc.length; ++i) {
				if (toc[i].level <= entry.level) {
					end = toc[i].line - 1;
					break;
				}
			}
			const endLine = end ?? document.lineCount - 1;
			return {
				...entry,
				sectionLocation: new vscode.Location(document.uri,
					new vscode.Range(
						entry.sectionLocation.range.start,
						new vscode.Position(endLine, document.lineAt(endLine).text.length)))
			};
		});
	}

	private static getHeaderLevel(markup: string): number {
		if (markup === '=') {
			return 1;
		} else if (markup === '-') {
			return 2;
		} else { // '#', '##', ...
			return markup.length;
		}
	}

	private static getHeaderText(header: string): string {
		return header.replace(/^\s*#+\s*(.*?)(\s+#+)?$/, (_, word) => word.trim());
	}

	public static readonly empty = new TableOfContents([], githubSlugifier);

	private constructor(
		public readonly entries: readonly TocEntry[],
		private readonly slugifier: Slugifier,
	) { }

	public lookup(fragment: string): TocEntry | undefined {
		const slug = this.slugifier.fromHeading(fragment);
		return this.entries.find(entry => entry.slug.equals(slug));
	}
}

export class MdTableOfContentsProvider extends Disposable {

	private readonly _cache: MdDocumentInfoCache<TableOfContents>;

	constructor(
		parser: IMdParser,
		workspaceContents: MdWorkspaceContents,
		private readonly logger: ILogger,
	) {
		super();
		this._cache = this._register(new MdDocumentInfoCache<TableOfContents>(workspaceContents, doc => {
			this.logger.verbose('TableOfContentsProvider', `create - ${doc.uri}`);
			return TableOfContents.create(parser, doc);
		}));
	}

	public async get(resource: vscode.Uri): Promise<TableOfContents> {
		return await this._cache.get(resource) ?? TableOfContents.empty;
	}

	public getForDocument(doc: SkinnyTextDocument): Promise<TableOfContents> {
		return this._cache.getForDocument(doc);
	}
}

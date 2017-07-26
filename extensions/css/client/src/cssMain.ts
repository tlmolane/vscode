/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';

import { languages, window, commands, workspace, ExtensionContext, DocumentColorProvider, Color, CancellationToken, TextDocument, ProviderResult, ColorInfo } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, RequestType, Range, TextEdit } from 'vscode-languageclient';
import { activateColorDecorations } from './colorDecorators';

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

namespace ColorSymbolRequest {
	export const type: RequestType<string, Range[], any, any> = new RequestType('css/colorSymbols');
}

class ColorProvider implements DocumentColorProvider {

	constructor(private client: LanguageClient) { }

	async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInfo[]> {
		const ranges = await this.client.sendRequest(ColorSymbolRequest.type, document.uri.toString());

		return ranges.map(r => {
			const range = this.client.protocol2CodeConverter.asRange(r);
			const color = Color.fromHex('#000000');
			const format = '#{red:X}{green:X}{blue:X}';
			const availableFormats = [format];

			return new ColorInfo(range, color, format, availableFormats);
		});
	}
}

// this method is called when vs code is activated
export function activate(context: ExtensionContext) {

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'out', 'cssServerMain.js'));
	// The debug options for the server
	let debugOptions = { execArgv: ['--nolazy', '--debug=6004'] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	// Options to control the language client
	const documentSelector = ['css', 'less', 'scss'];
	let clientOptions: LanguageClientOptions = {
		documentSelector: documentSelector,
		synchronize: {
			configurationSection: ['css', 'scss', 'less']
		},
		initializationOptions: {
		}
	};

	// Create the language client and start the client.
	let client = new LanguageClient('css', localize('cssserver.name', 'CSS Language Server'), serverOptions, clientOptions);

	let disposable = client.start();
	// Push the disposable to the context's subscriptions so that the
	// client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);

	client.onReady().then(_ => {
		let colorRequestor = (uri: string) => {
			return client.sendRequest(ColorSymbolRequest.type, uri).then(ranges => ranges.map(client.protocol2CodeConverter.asRange));
		};
		let isDecoratorEnabled = (languageId: string) => {
			return workspace.getConfiguration().get<boolean>(languageId + '.colorDecorators.enable');
		};

		const colorProvider = new ColorProvider(client);
		context.subscriptions.push(languages.registerColorProvider('css', colorProvider));

		disposable = activateColorDecorations(colorRequestor, { css: true, scss: true, less: true }, isDecoratorEnabled);
		context.subscriptions.push(disposable);

		languages.registerColorProvider(documentSelector, <DocumentColorProvider>{
			provideDocumentColors(document: TextDocument, token: CancellationToken): ProviderResult<ColorInfo[]> {
				const colorInfos: ColorInfo[] = [];
				colorRequestor(document.uri.toString()).then(ranges => {
					ranges.forEach(range => {
						colorInfos.push(new ColorInfo(undefined, undefined, '', []));
					});
				});
				return colorInfos;
			}
		});
	});

	let indentationRules = {
		increaseIndentPattern: /(^.*\{[^}]*$)/,
		decreaseIndentPattern: /^\s*\}/
	};

	languages.setLanguageConfiguration('css', {
		wordPattern: /(#?-?\d*\.\d\w*%?)|(::?[\w-]*(?=[^,{;]*[,{]))|(([@#.!])?[\w-?]+%?|[@#!.])/g,
		indentationRules: indentationRules
	});

	languages.setLanguageConfiguration('less', {
		wordPattern: /(#?-?\d*\.\d\w*%?)|(::?[\w-]+(?=[^,{;]*[,{]))|(([@#.!])?[\w-?]+%?|[@#!.])/g,
		indentationRules: indentationRules
	});

	languages.setLanguageConfiguration('scss', {
		wordPattern: /(#?-?\d*\.\d\w*%?)|(::?[\w-]*(?=[^,{;]*[,{]))|(([@$#.!])?[\w-?]+%?|[@#!$.])/g,
		indentationRules: indentationRules
	});

	commands.registerCommand('_css.applyCodeAction', applyCodeAction);

	function applyCodeAction(uri: string, documentVersion: number, edits: TextEdit[]) {
		let textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`CSS fix is outdated and can't be applied to the document.`);
			}
			textEditor.edit(mutator => {
				for (let edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			}).then(success => {
				if (!success) {
					window.showErrorMessage('Failed to apply CSS fix to the document. Please consider opening an issue with steps to reproduce.');
				}
			});
		}
	}
}


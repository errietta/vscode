/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CompareResult } from 'vs/base/common/arrays';
import { IModelDeltaDecoration, MinimapPosition, OverviewRulerLane } from 'vs/editor/common/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { autorun, derivedObservable } from 'vs/workbench/contrib/audioCues/browser/observable';
import { LineRange } from 'vs/workbench/contrib/mergeEditor/browser/model/lineRange';
import { applyObservableDecorations, join } from 'vs/workbench/contrib/mergeEditor/browser/utils';
import { handledConflictMinimapOverViewRulerColor, unhandledConflictMinimapOverViewRulerColor } from 'vs/workbench/contrib/mergeEditor/browser/view/colors';
import { CodeEditorView, ICodeEditorViewOptions } from './codeEditorView';

export class ResultCodeEditorView extends CodeEditorView {
	private readonly decorations = derivedObservable('decorations', reader => {
		const viewModel = this.viewModel.read(reader);
		if (!viewModel) {
			return [];
		}
		const model = viewModel.model;
		const result = new Array<IModelDeltaDecoration>();

		const baseRangeWithStoreAndTouchingDiffs = join(
			model.modifiedBaseRanges.read(reader),
			model.resultDiffs.read(reader),
			(baseRange, diff) => baseRange.baseRange.touches(diff.inputRange)
				? CompareResult.neitherLessOrGreaterThan
				: LineRange.compareByStart(
					baseRange.baseRange,
					diff.inputRange
				)
		);

		const activeModifiedBaseRange = viewModel.activeModifiedBaseRange.read(reader);

		for (const m of baseRangeWithStoreAndTouchingDiffs) {
			const modifiedBaseRange = m.left;

			if (modifiedBaseRange) {
				const range = model.getRangeInResult(modifiedBaseRange.baseRange, reader).toInclusiveRange();
				if (range) {
					const blockClassNames = ['merge-editor-block'];
					const isHandled = model.isHandled(modifiedBaseRange).read(reader);
					if (isHandled) {
						blockClassNames.push('handled');
					}
					if (modifiedBaseRange === activeModifiedBaseRange) {
						blockClassNames.push('active');
					}
					blockClassNames.push('result');

					result.push({
						range,
						options: {
							isWholeLine: true,
							blockClassName: blockClassNames.join(' '),
							description: 'Result Diff',
							minimap: {
								position: MinimapPosition.Gutter,
								color: { id: isHandled ? handledConflictMinimapOverViewRulerColor : unhandledConflictMinimapOverViewRulerColor },
							},
							overviewRuler: {
								position: OverviewRulerLane.Center,
								color: { id: isHandled ? handledConflictMinimapOverViewRulerColor : unhandledConflictMinimapOverViewRulerColor },
							}
						}
					});
				}
			}
		}
		return result;
	});

	constructor(
		options: ICodeEditorViewOptions,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(options, instantiationService);

		this._register(applyObservableDecorations(this.editor, this.decorations));


		this._register(autorun(reader => {
			const model = this.model.read(reader);
			if (!model) {
				return;
			}
			const count = model.unhandledConflictsCount.read(reader);

			// TODO @joh
			this._detail.setLabel(`${count} Remaining Conflicts`);
		}, 'update label'));
	}
}

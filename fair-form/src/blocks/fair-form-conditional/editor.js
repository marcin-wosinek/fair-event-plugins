import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import { PanelBody, SelectControl, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';

const ALLOWED_BLOCKS = [
	'core/heading',
	'core/paragraph',
	'core/list',
	'fair-audience/fair-form-short-text',
	'fair-audience/fair-form-long-text',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-radio',
	'fair-audience/fair-form-file-upload',
	'fair-audience/fair-form-consent',
	'fair-audience/fair-form-conditional',
	'fair-audience/fair-form-mailing-signup',
];

const OPERATOR_OPTIONS = [
	{ label: __('equals', 'fair-audience'), value: 'equals' },
	{ label: __('not equals', 'fair-audience'), value: 'not_equals' },
	{ label: __('contains', 'fair-audience'), value: 'contains' },
	{ label: __('is not empty', 'fair-audience'), value: 'not_empty' },
];

// Event options are boolean per checkbox, so they get a dedicated
// selected/not-selected operator pair rather than reusing equals/contains.
const EVENT_OPTION_OPERATOR_OPTIONS = [
	{ label: __('is selected', 'fair-audience'), value: 'selected' },
	{ label: __('is not selected', 'fair-audience'), value: 'not_selected' },
];

const SOURCE_OPTIONS = [
	{ label: __('Question', 'fair-audience'), value: 'question' },
	{ label: __('Event option', 'fair-audience'), value: 'eventOption' },
];

const OPTION_BLOCK_PARENTS = [
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-radio',
];

function findQuestionBlocks(blocks) {
	const questions = [];
	for (const block of blocks) {
		if (
			block.attributes?.questionKey &&
			block.name !== 'fair-audience/fair-form-conditional'
		) {
			const question = {
				key: block.attributes.questionKey,
				text:
					block.attributes.questionText ||
					block.attributes.questionKey,
				blockName: block.name,
			};
			if (OPTION_BLOCK_PARENTS.includes(block.name)) {
				question.options = (block.innerBlocks || [])
					.filter((b) => b.name === 'fair-audience/fair-form-option')
					.map((b) => b.attributes?.value)
					.filter(Boolean);
			}
			questions.push(question);
		}
		if (block.innerBlocks?.length) {
			questions.push(...findQuestionBlocks(block.innerBlocks));
		}
	}
	return questions;
}

registerBlockType('fair-audience/fair-form-conditional', {
	edit: ({ attributes, setAttributes, clientId }) => {
		const {
			conditionSource,
			conditionQuestionKey,
			conditionOperator,
			conditionValue,
			conditionOptionShortName,
		} = attributes;

		const { questionOptions, isEventSignup } = useSelect(
			(select) => {
				const { getBlockParents, getBlocks, getBlock } =
					select('core/block-editor');
				const parents = getBlockParents(clientId);
				// Find the nearest form-like parent: a Fair Form or an Event
				// Signup (which accepts nested fair-form questions since #615).
				const formParentId = parents.find((parentId) => {
					const parentBlock = getBlock(parentId);
					return (
						parentBlock?.name === 'fair-audience/fair-form' ||
						parentBlock?.name === 'fair-audience/event-signup'
					);
				});
				if (!formParentId) {
					return { questionOptions: [], isEventSignup: false };
				}
				const formBlock = getBlock(formParentId);
				const formBlocks = getBlocks(formParentId);
				return {
					questionOptions: findQuestionBlocks(formBlocks),
					isEventSignup:
						formBlock?.name === 'fair-audience/event-signup',
				};
			},
			[clientId]
		);

		// The event-option source is only meaningful inside an Event Signup,
		// whose runtime option checkboxes carry the short name. Outside one,
		// keep the source on "question" regardless of the stored attribute.
		const source = isEventSignup ? conditionSource : 'question';
		const isEventOption = source === 'eventOption';

		const questionSelectOptions = [
			{
				label: __('— Select a question —', 'fair-audience'),
				value: '',
			},
			...questionOptions.map((q) => ({
				label: q.text || q.key,
				value: q.key,
			})),
		];

		const selectedQuestion = questionOptions.find(
			(q) => q.key === conditionQuestionKey
		);
		const hasOptions =
			selectedQuestion?.options && selectedQuestion.options.length > 0;

		// Keep the operator valid for the active source: the question
		// operators (equals/…) and the event-option operators
		// (selected/not_selected) are disjoint sets.
		const eventOptionOperator =
			conditionOperator === 'not_selected' ? 'not_selected' : 'selected';

		const isConfigured = isEventOption
			? !!conditionOptionShortName
			: !!conditionQuestionKey;

		let conditionLabel;
		if (!isConfigured) {
			conditionLabel = __('No condition set', 'fair-audience');
		} else if (isEventOption) {
			conditionLabel = `${conditionOptionShortName} ${
				eventOptionOperator === 'not_selected'
					? __('is not selected', 'fair-audience')
					: __('is selected', 'fair-audience')
			}`;
		} else {
			conditionLabel = `${conditionQuestionKey} ${conditionOperator}${
				conditionOperator !== 'not_empty' ? ` "${conditionValue}"` : ''
			}`;
		}

		const blockProps = useBlockProps({
			className: `fair-form-conditional-editor${
				!isConfigured
					? ' fair-form-conditional-editor--unconfigured'
					: ''
			}`,
		});

		const innerBlocksProps = useInnerBlocksProps(
			{ className: 'fair-form-conditional-inner-blocks' },
			{
				allowedBlocks: ALLOWED_BLOCKS,
				renderAppender: InnerBlocks.ButtonBlockAppender,
			}
		);

		return (
			<>
				<InspectorControls>
					<PanelBody
						title={__('Condition Settings', 'fair-audience')}
					>
						{isEventSignup && (
							<SelectControl
								label={__('Condition source', 'fair-audience')}
								value={source}
								options={SOURCE_OPTIONS}
								onChange={(value) =>
									setAttributes({
										conditionSource: value,
										// Reset the operator to one valid for the
										// newly selected source.
										conditionOperator:
											value === 'eventOption'
												? 'selected'
												: 'equals',
									})
								}
							/>
						)}
						{isEventOption ? (
							<>
								<TextControl
									label={__(
										'Option short name',
										'fair-audience'
									)}
									value={conditionOptionShortName}
									onChange={(value) =>
										setAttributes({
											conditionOptionShortName: value,
										})
									}
									help={__(
										"Enter the option's short name (set it in the event's Tickets tab). Options can't be listed here because they come from the selected event date at render time.",
										'fair-audience'
									)}
								/>
								<SelectControl
									label={__('Operator', 'fair-audience')}
									value={eventOptionOperator}
									options={EVENT_OPTION_OPERATOR_OPTIONS}
									onChange={(value) =>
										setAttributes({
											conditionOperator: value,
										})
									}
								/>
							</>
						) : (
							<>
								<SelectControl
									label={__(
										'Show when question',
										'fair-audience'
									)}
									value={conditionQuestionKey}
									options={questionSelectOptions}
									onChange={(value) => {
										const question = questionOptions.find(
											(q) => q.key === value
										);
										const updates = {
											conditionQuestionKey: value,
											conditionValue: '',
										};
										if (
											question?.blockName ===
											'fair-audience/fair-form-multiselect'
										) {
											updates.conditionOperator =
												'contains';
										}
										setAttributes(updates);
									}}
								/>
								<SelectControl
									label={__('Operator', 'fair-audience')}
									value={conditionOperator}
									options={OPERATOR_OPTIONS}
									onChange={(value) =>
										setAttributes({
											conditionOperator: value,
										})
									}
								/>
								{conditionOperator !== 'not_empty' &&
									(hasOptions ? (
										<SelectControl
											label={__('Value', 'fair-audience')}
											value={conditionValue}
											options={[
												{
													label: __(
														'— Select a value —',
														'fair-audience'
													),
													value: '',
												},
												...selectedQuestion.options.map(
													(opt) => ({
														label: opt,
														value: opt,
													})
												),
											]}
											onChange={(value) =>
												setAttributes({
													conditionValue: value,
												})
											}
										/>
									) : (
										<TextControl
											label={__('Value', 'fair-audience')}
											value={conditionValue}
											onChange={(value) =>
												setAttributes({
													conditionValue: value,
												})
											}
											help={__(
												'The value to compare against.',
												'fair-audience'
											)}
										/>
									))}
							</>
						)}
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<span className="fair-form-conditional-editor-label">
						<span className="dashicons dashicons-visibility" />
						{conditionLabel}
					</span>
					<div {...innerBlocksProps} />
				</div>
			</>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
});

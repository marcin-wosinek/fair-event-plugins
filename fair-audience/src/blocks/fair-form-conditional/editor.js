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
	'fair-audience/fair-form-conditional',
	'fair-audience/fair-form-mailing-signup',
];

const OPERATOR_OPTIONS = [
	{ label: __('equals', 'fair-audience'), value: 'equals' },
	{ label: __('not equals', 'fair-audience'), value: 'not_equals' },
	{ label: __('contains', 'fair-audience'), value: 'contains' },
	{ label: __('is not empty', 'fair-audience'), value: 'not_empty' },
];

function findQuestionBlocks(blocks) {
	const questions = [];
	for (const block of blocks) {
		if (
			block.attributes?.questionKey &&
			block.name !== 'fair-audience/fair-form-conditional'
		) {
			questions.push({
				key: block.attributes.questionKey,
				text:
					block.attributes.questionText ||
					block.attributes.questionKey,
			});
		}
		if (block.innerBlocks?.length) {
			questions.push(...findQuestionBlocks(block.innerBlocks));
		}
	}
	return questions;
}

registerBlockType('fair-audience/fair-form-conditional', {
	edit: ({ attributes, setAttributes, clientId }) => {
		const { conditionQuestionKey, conditionOperator, conditionValue } =
			attributes;

		const questionOptions = useSelect(
			(select) => {
				const { getBlockParents, getBlocks } =
					select('core/block-editor');
				const parents = getBlockParents(clientId);
				// Find the fair-form parent (the topmost relevant parent).
				const formParentId = parents.find((parentId) => {
					const parentBlock =
						select('core/block-editor').getBlock(parentId);
					return parentBlock?.name === 'fair-audience/fair-form';
				});
				if (!formParentId) {
					return [];
				}
				const formBlocks = getBlocks(formParentId);
				return findQuestionBlocks(formBlocks);
			},
			[clientId]
		);

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

		const isConfigured = !!conditionQuestionKey;

		const conditionLabel = isConfigured
			? `${conditionQuestionKey} ${conditionOperator}${
					conditionOperator !== 'not_empty'
						? ` "${conditionValue}"`
						: ''
			  }`
			: __('No condition set', 'fair-audience');

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
						<SelectControl
							label={__('Show when question', 'fair-audience')}
							value={conditionQuestionKey}
							options={questionSelectOptions}
							onChange={(value) =>
								setAttributes({ conditionQuestionKey: value })
							}
						/>
						<SelectControl
							label={__('Operator', 'fair-audience')}
							value={conditionOperator}
							options={OPERATOR_OPTIONS}
							onChange={(value) =>
								setAttributes({ conditionOperator: value })
							}
						/>
						{conditionOperator !== 'not_empty' && (
							<TextControl
								label={__('Value', 'fair-audience')}
								value={conditionValue}
								onChange={(value) =>
									setAttributes({ conditionValue: value })
								}
								help={__(
									'The value to compare against.',
									'fair-audience'
								)}
							/>
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

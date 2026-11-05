/**
 * Editor UI shared by the choice questions: Select One, Multiselect and
 * Radio (#2077).
 *
 * `ChoiceQuestionEdit` is the manual editor: question settings, the question
 * label and the typed option blocks. `CategoryChoiceQuestionEdit` adds the
 * option-source controls on top of it, for the questions that can take their
 * choices from post categories (Select One and Multiselect; Radio stays on
 * typed options only, #1999).
 *
 * @package FairForm
 */

import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { autosizeTextarea } from 'fair-events-shared/src/questionnaire.js';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';
import { isCategorySource, useCategories } from './category-options.js';
import {
	OptionSourcePanel,
	CategoryChoicesPreview,
} from './OptionSourceControls.js';

const ALLOWED_BLOCKS = [ 'fair-form/fair-form-option' ];

/**
 * Attribute updates for a new question text. The key follows the text while
 * it is empty or still the one generated from the previous text; a key the
 * author customized is kept.
 *
 * @param {Object} attributes Current question attributes.
 * @param {string} value      New question text.
 * @return {Object} Attributes to set.
 */
export function questionTextUpdates( attributes, value ) {
	const { questionText, questionKey } = attributes;
	const updates = { questionText: value };
	if (
		! questionKey ||
		questionKey === generateQuestionKey( questionText )
	) {
		updates.questionKey = generateQuestionKey( value );
	}
	return updates;
}

/**
 * Manual choice-question editor.
 *
 * @param {Object}   props
 * @param {Object}   props.attributes       Question block attributes.
 * @param {Function} props.setAttributes    Block attribute setter.
 * @param {string}   props.className        Wrapper class naming the question type.
 * @param {Element}  [props.extraControls]  More inspector panels.
 * @param {Element}  [props.optionsPreview] Shown instead of the typed options;
 *                                          they stay in the block meanwhile.
 */
export function ChoiceQuestionEdit( {
	attributes,
	setAttributes,
	className,
	extraControls = null,
	optionsPreview = null,
} ) {
	const { questionText, questionKey, required } = attributes;

	const blockProps = useBlockProps( {
		className: `fair-form-question ${ className }`,
	} );

	const innerBlocksProps = useInnerBlocksProps(
		{ className: 'fair-form-options-list' },
		{
			allowedBlocks: ALLOWED_BLOCKS,
			renderAppender: InnerBlocks.ButtonBlockAppender,
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Question Settings', 'fair-form' ) }>
					<TextControl
						label={ __( 'Question Key', 'fair-form' ) }
						value={ questionKey }
						onChange={ ( value ) =>
							setAttributes( { questionKey: value } )
						}
						help={ __(
							'A unique identifier for this question. Used internally.',
							'fair-form'
						) }
					/>
					<ToggleControl
						label={ __( 'Required', 'fair-form' ) }
						checked={ required }
						onChange={ ( value ) =>
							setAttributes( { required: value } )
						}
					/>
				</PanelBody>
				{ extraControls }
			</InspectorControls>

			<div { ...blockProps }>
				<p>
					<span className="fair-form-question-header">
						<textarea
							rows={ 1 }
							ref={ autosizeTextarea }
							value={ questionText }
							onChange={ ( e ) => {
								autosizeTextarea( e.target );
								setAttributes(
									questionTextUpdates(
										attributes,
										e.target.value
									)
								);
							} }
							placeholder={ __(
								'Enter your question...',
								'fair-form'
							) }
							className="fair-form-question-label-input"
						/>
						{ required && <span className="required"> *</span> }
					</span>
				</p>
				{ optionsPreview ?? <div { ...innerBlocksProps } /> }
			</div>
		</>
	);
}

/**
 * Choice-question editor whose choices can also come from post categories.
 *
 * @param {Object}   props
 * @param {Object}   props.attributes    Question block attributes.
 * @param {Function} props.setAttributes Block attribute setter.
 * @param {string}   props.clientId      Block client ID.
 * @param {string}   props.className     Wrapper class naming the question type.
 */
export function CategoryChoiceQuestionEdit( {
	attributes,
	setAttributes,
	clientId,
	className,
} ) {
	const usesCategories = isCategorySource( attributes );
	const categoriesState = useCategories( usesCategories );
	const manualOptionCount = useSelect(
		( select ) => select( 'core/block-editor' ).getBlockCount( clientId ),
		[ clientId ]
	);

	return (
		<ChoiceQuestionEdit
			attributes={ attributes }
			setAttributes={ setAttributes }
			className={ className }
			extraControls={
				<OptionSourcePanel
					attributes={ attributes }
					setAttributes={ setAttributes }
					categoriesState={ categoriesState }
				/>
			}
			optionsPreview={
				usesCategories ? (
					<CategoryChoicesPreview
						attributes={ attributes }
						categoriesState={ categoriesState }
						manualOptionCount={ manualOptionCount }
					/>
				) : null
			}
		/>
	);
}

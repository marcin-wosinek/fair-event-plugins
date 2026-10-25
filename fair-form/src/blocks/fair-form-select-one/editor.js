import './style.css';

import { registerBlockType, createBlock } from '@wordpress/blocks';
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
import { isCategorySource, useCategories } from '../shared/category-options.js';
import {
	OptionSourcePanel,
	CategoryChoicesPreview,
} from '../shared/OptionSourceControls.js';

const ALLOWED_BLOCKS = [ 'fair-audience/fair-form-option' ];

registerBlockType( 'fair-audience/fair-form-select-one', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-audience/fair-form-multiselect' ],
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-audience/fair-form-multiselect',
						attributes,
						innerBlocks
					);
				},
			},
			{
				type: 'block',
				blocks: [ 'fair-audience/fair-form-radio' ],
				// Radio questions have no category source (#1999).
				isMatch: ( attributes ) => ! isCategorySource( attributes ),
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-audience/fair-form-radio',
						attributes,
						innerBlocks
					);
				},
			},
		],
	},
	edit: ( { attributes, setAttributes, clientId } ) => {
		const { questionText, questionKey, required } = attributes;
		const usesCategories = isCategorySource( attributes );
		const categoriesState = useCategories( usesCategories );
		const manualOptionCount = useSelect(
			( select ) =>
				select( 'core/block-editor' ).getBlockCount( clientId ),
			[ clientId ]
		);

		const onQuestionTextChange = ( value ) => {
			const updates = { questionText: value };
			if (
				! questionKey ||
				questionKey === generateQuestionKey( questionText )
			) {
				updates.questionKey = generateQuestionKey( value );
			}
			setAttributes( updates );
		};

		const blockProps = useBlockProps( {
			className: 'fair-form-question fair-form-question-select-one',
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
					<OptionSourcePanel
						attributes={ attributes }
						setAttributes={ setAttributes }
						categoriesState={ categoriesState }
					/>
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
									onQuestionTextChange( e.target.value );
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
					{ usesCategories ? (
						<CategoryChoicesPreview
							attributes={ attributes }
							categoriesState={ categoriesState }
							manualOptionCount={ manualOptionCount }
						/>
					) : (
						<div { ...innerBlocksProps } />
					) }
				</div>
			</>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
} );

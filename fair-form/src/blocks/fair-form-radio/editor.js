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
import { autosizeTextarea } from 'fair-events-shared/src/questionnaire.js';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';

const ALLOWED_BLOCKS = [ 'fair-audience/fair-form-option' ];

registerBlockType( 'fair-audience/fair-form-radio', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-audience/fair-form-select-one' ],
				transform: ( attributes, innerBlocks ) => {
					return createBlock(
						'fair-audience/fair-form-select-one',
						{ ...attributes, displayAs: 'select' },
						innerBlocks
					);
				},
			},
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
		],
	},
	edit: ( { attributes, setAttributes } ) => {
		const { questionText, questionKey, required } = attributes;

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
			className: 'fair-form-question fair-form-question-radio',
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
					<div { ...innerBlocksProps } />
				</div>
			</>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
} );

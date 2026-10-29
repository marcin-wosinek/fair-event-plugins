import './style.css';

import { createBlock } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	RangeControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { autosizeTextarea } from 'fair-events-shared/src/questionnaire.js';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-long-text', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-short-text' ],
				transform: ( attributes ) => {
					return createBlock(
						'fair-form/fair-form-short-text',
						attributes
					);
				},
			},
		],
	},
	edit: ( { attributes, setAttributes } ) => {
		const { questionText, questionKey, required, placeholder, rows } =
			attributes;

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
			className: 'fair-form-question fair-form-question-long-text',
		} );

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
								'A unique identifier for this question (e.g. "comments"). Used internally.',
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
						<TextControl
							label={ __( 'Placeholder', 'fair-form' ) }
							value={ placeholder }
							onChange={ ( value ) =>
								setAttributes( { placeholder: value } )
							}
						/>
						<RangeControl
							label={ __( 'Rows', 'fair-form' ) }
							value={ rows }
							onChange={ ( value ) =>
								setAttributes( { rows: value } )
							}
							min={ 2 }
							max={ 20 }
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
						<br />
						<textarea
							disabled
							rows={ rows }
							placeholder={
								placeholder ||
								__( 'Type your answer...', 'fair-form' )
							}
						/>
					</p>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
} );

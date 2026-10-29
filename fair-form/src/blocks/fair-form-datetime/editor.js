import './style.css';

import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-datetime', {
	edit: ( { attributes, setAttributes } ) => {
		const { questionText, questionKey, required, placeholder } = attributes;

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
			className: 'fair-form-question fair-form-question-datetime',
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
								'A unique identifier for this question (e.g. "appointment_slot"). Used internally.',
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
					</PanelBody>
				</InspectorControls>

				<div { ...blockProps }>
					<p>
						<input
							type="text"
							value={ questionText }
							onChange={ ( e ) =>
								onQuestionTextChange( e.target.value )
							}
							placeholder={ __(
								'Enter your question...',
								'fair-form'
							) }
							className="fair-form-question-label-input"
						/>
						{ required && <span className="required"> *</span> }
						<br />
						<input
							type="datetime-local"
							disabled
							placeholder={ placeholder }
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

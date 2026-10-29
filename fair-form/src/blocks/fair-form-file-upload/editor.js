import './style.css';

import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { autosizeTextarea } from 'fair-events-shared/src/questionnaire.js';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-file-upload', {
	edit: ( { attributes, setAttributes } ) => {
		const {
			questionText,
			questionKey,
			required,
			acceptedTypes,
			maxFileSize,
		} = attributes;

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
			className: 'fair-form-question fair-form-question-file-upload',
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
								'A unique identifier for this question (e.g. "photo_upload"). Used internally.',
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
							label={ __( 'Accepted File Types', 'fair-form' ) }
							value={ acceptedTypes }
							onChange={ ( value ) =>
								setAttributes( { acceptedTypes: value } )
							}
							help={ __(
								'MIME types or extensions (e.g. "image/*", ".pdf,.doc", "image/png,image/jpeg").',
								'fair-form'
							) }
						/>
						<NumberControl
							label={ __( 'Max File Size (MB)', 'fair-form' ) }
							value={ maxFileSize }
							onChange={ ( value ) =>
								setAttributes( {
									maxFileSize: parseInt( value, 10 ) || 5,
								} )
							}
							min={ 1 }
							max={ 100 }
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
						<input type="file" disabled />
						<span className="fair-form-file-upload-help">
							{ __( 'Max file size:', 'fair-form' ) }{ ' ' }
							{ maxFileSize } MB
						</span>
					</p>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
} );

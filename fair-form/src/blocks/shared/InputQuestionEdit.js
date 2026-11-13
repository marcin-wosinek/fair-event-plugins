/**
 * Editor UI shared by the single-input questions: Date, Date & Time, Email
 * and Short Text (#2235).
 *
 * Each block passes its wrapper class, native input type, question-key help
 * and preview placeholder fallback; the question settings, label editing,
 * required marker and disabled preview are the same for all of them.
 *
 * @package FairForm
 */

import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { autosizeTextarea } from 'fair-events-shared/src/questionnaire.js';
import { questionTextUpdates } from './question-text.js';

/**
 * Single-input question editor.
 *
 * @param {Object}   props
 * @param {Object}   props.attributes           Question block attributes.
 * @param {Function} props.setAttributes        Block attribute setter.
 * @param {string}   props.className            Wrapper class naming the question type.
 * @param {string}   props.inputType            Native type of the preview input.
 * @param {string}   props.keyHelp              Help text of the question-key control.
 * @param {string}   [props.previewPlaceholder] Preview placeholder when none is set.
 * @param {boolean}  [props.multilineLabel]     Edit the label in an autosizing textarea.
 */
export function InputQuestionEdit( {
	attributes,
	setAttributes,
	className,
	inputType,
	keyHelp,
	previewPlaceholder = '',
	multilineLabel = false,
} ) {
	const { questionText, questionKey, required, placeholder } = attributes;

	const blockProps = useBlockProps( {
		className: `fair-form-question ${ className }`,
	} );

	const labelProps = {
		value: questionText,
		placeholder: __( 'Enter your question...', 'fair-form' ),
		className: 'fair-form-question-label-input',
	};
	const onLabelChange = ( value ) =>
		setAttributes( questionTextUpdates( attributes, value ) );
	const requiredMarker = required && <span className="required"> *</span>;

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
						help={ keyHelp }
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
					{ multilineLabel ? (
						<span className="fair-form-question-header">
							<textarea
								{ ...labelProps }
								rows={ 1 }
								ref={ autosizeTextarea }
								onChange={ ( e ) => {
									autosizeTextarea( e.target );
									onLabelChange( e.target.value );
								} }
							/>
							{ requiredMarker }
						</span>
					) : (
						<>
							<input
								{ ...labelProps }
								type="text"
								onChange={ ( e ) =>
									onLabelChange( e.target.value )
								}
							/>
							{ requiredMarker }
						</>
					) }
					<br />
					<input
						type={ inputType }
						disabled
						placeholder={ placeholder || previewPlaceholder }
					/>
				</p>
			</div>
		</>
	);
}

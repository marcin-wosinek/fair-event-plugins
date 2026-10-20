import './style.css';

import { registerBlockType, createBlock } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';

registerBlockType( 'fair-audience/fair-form-url', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-audience/fair-form-short-text' ],
				transform: ( attributes ) => {
					return createBlock(
						'fair-audience/fair-form-short-text',
						attributes
					);
				},
			},
		],
	},
	edit: ( { attributes, setAttributes } ) => {
		const {
			questionText,
			questionKey,
			required,
			placeholder,
			extractEventDetails,
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
			className: 'fair-form-question fair-form-question-url',
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
								'A unique identifier for this question (e.g. "website"). Used internally.',
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
						<ToggleControl
							label={ __(
								'Read event details from the linked page',
								'fair-form'
							) }
							help={ __(
								'Once the visitor leaves the field, any event details the link publishes (title, dates, location) are shown right underneath it; nothing is stored.',
								'fair-form'
							) }
							checked={ extractEventDetails }
							onChange={ ( value ) =>
								setAttributes( { extractEventDetails: value } )
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
							type="text"
							disabled
							placeholder={
								placeholder ||
								__( 'https://example.com', 'fair-form' )
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

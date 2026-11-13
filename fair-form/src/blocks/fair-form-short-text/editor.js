import './style.css';

import { createBlock } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { InputQuestionEdit } from '../shared/InputQuestionEdit.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-short-text', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-long-text' ],
				transform: ( attributes ) => {
					return createBlock(
						'fair-form/fair-form-long-text',
						attributes
					);
				},
			},
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-phone' ],
				transform: ( attributes ) => {
					return createBlock(
						'fair-form/fair-form-phone',
						attributes
					);
				},
			},
			{
				type: 'block',
				blocks: [ 'fair-form/fair-form-url' ],
				transform: ( attributes ) => {
					return createBlock( 'fair-form/fair-form-url', attributes );
				},
			},
		],
	},
	edit: ( { attributes, setAttributes } ) => (
		<InputQuestionEdit
			attributes={ attributes }
			setAttributes={ setAttributes }
			className="fair-form-question-short-text"
			inputType="text"
			keyHelp={ __(
				'A unique identifier for this question (e.g. "favorite_color"). Used internally.',
				'fair-form'
			) }
			previewPlaceholder={ __( 'Type your answer...', 'fair-form' ) }
			multilineLabel
		/>
	),
	save: () => null,
} );

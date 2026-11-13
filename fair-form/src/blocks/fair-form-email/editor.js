import './style.css';

import { __ } from '@wordpress/i18n';
import { InputQuestionEdit } from '../shared/InputQuestionEdit.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-email', {
	edit: ( { attributes, setAttributes } ) => (
		<InputQuestionEdit
			attributes={ attributes }
			setAttributes={ setAttributes }
			className="fair-form-question-email"
			inputType="email"
			keyHelp={ __(
				'A unique identifier for this question (e.g. "email"). Used internally.',
				'fair-form'
			) }
			previewPlaceholder={ __( 'your@email.com', 'fair-form' ) }
		/>
	),
	save: () => null,
} );

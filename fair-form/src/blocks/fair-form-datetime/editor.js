import './style.css';

import { __ } from '@wordpress/i18n';
import { InputQuestionEdit } from '../shared/InputQuestionEdit.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

registerFormBlockType( 'fair-form-datetime', {
	edit: ( { attributes, setAttributes } ) => (
		<InputQuestionEdit
			attributes={ attributes }
			setAttributes={ setAttributes }
			className="fair-form-question-datetime"
			inputType="datetime-local"
			keyHelp={ __(
				'A unique identifier for this question (e.g. "appointment_slot"). Used internally.',
				'fair-form'
			) }
		/>
	),
	save: () => null,
} );

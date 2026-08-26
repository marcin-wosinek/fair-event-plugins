import { createRoot } from '@wordpress/element';
import QuestionnaireResponses from './QuestionnaireResponses.js';
import './style.css';

const rootElement = document.getElementById(
	'fair-form-questionnaire-responses-root'
);
if ( rootElement ) {
	createRoot( rootElement ).render( <QuestionnaireResponses /> );
}

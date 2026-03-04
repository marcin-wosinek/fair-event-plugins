import { render } from '@wordpress/element';
import QuestionnaireResponses from './QuestionnaireResponses.js';

const rootElement = document.getElementById(
	'fair-audience-questionnaire-responses-root'
);
if (rootElement) {
	render(<QuestionnaireResponses />, rootElement);
}

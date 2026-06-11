import { createRoot } from '@wordpress/element';
import QuestionnaireResponses from './QuestionnaireResponses.js';

const rootElement = document.getElementById(
	'fair-audience-questionnaire-responses-root'
);
if (rootElement) {
	createRoot(rootElement).render(<QuestionnaireResponses />);
}

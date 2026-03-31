import { render } from '@wordpress/element';
import FormAnswers from './FormAnswers.js';

const rootElement = document.getElementById('fair-audience-form-answers-root');
if (rootElement) {
	render(<FormAnswers />, rootElement);
}

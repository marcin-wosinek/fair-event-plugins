import { createRoot } from '@wordpress/element';
import AnswersOverview from './AnswersOverview.js';
import './style.css';

const rootElement = document.getElementById('fair-form-answers-overview-root');
if (rootElement) {
	createRoot(rootElement).render(<AnswersOverview />);
}

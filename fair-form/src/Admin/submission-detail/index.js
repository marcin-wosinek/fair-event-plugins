import { createRoot } from '@wordpress/element';
import SubmissionDetail from './SubmissionDetail.js';

const rootElement = document.getElementById('fair-form-submission-detail-root');
if (rootElement) {
	createRoot(rootElement).render(<SubmissionDetail />);
}

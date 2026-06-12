import { createRoot } from '@wordpress/element';
import SubmissionDetail from './SubmissionDetail.js';

const rootElement = document.getElementById(
	'fair-audience-submission-detail-root'
);
if (rootElement) {
	createRoot(rootElement).render(<SubmissionDetail />);
}

import { render } from '@wordpress/element';
import SubmissionDetail from './SubmissionDetail.js';

const rootElement = document.getElementById(
	'fair-audience-submission-detail-root'
);
if (rootElement) {
	render(<SubmissionDetail />, rootElement);
}

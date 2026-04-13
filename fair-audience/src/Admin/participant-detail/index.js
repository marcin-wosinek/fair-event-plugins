import { render } from '@wordpress/element';
import ParticipantDetail from './ParticipantDetail.js';

const rootElement = document.getElementById(
	'fair-audience-participant-detail-root'
);
if (rootElement) {
	render(<ParticipantDetail />, rootElement);
}

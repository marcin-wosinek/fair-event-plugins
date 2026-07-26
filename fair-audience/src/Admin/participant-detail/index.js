import { createRoot } from '@wordpress/element';
import ParticipantDetail from './ParticipantDetail.js';
import './style.css';

const rootElement = document.getElementById(
	'fair-audience-participant-detail-root'
);
if (rootElement) {
	createRoot(rootElement).render(<ParticipantDetail />);
}

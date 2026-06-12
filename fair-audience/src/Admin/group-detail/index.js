import { createRoot } from '@wordpress/element';
import GroupDetail from './GroupDetail.js';

const rootElement = document.getElementById('fair-audience-group-detail-root');
if (rootElement) {
	createRoot(rootElement).render(<GroupDetail />);
}

import { createRoot } from '@wordpress/element';
import FeeDetail from './FeeDetail.js';

const rootElement = document.getElementById('fair-audience-fee-detail-root');
if (rootElement) {
	createRoot(rootElement).render(<FeeDetail />);
}

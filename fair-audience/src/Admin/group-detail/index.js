import { render } from '@wordpress/element';
import GroupDetail from './GroupDetail.js';

const rootElement = document.getElementById('fair-audience-group-detail-root');
if (rootElement) {
	render(<GroupDetail />, rootElement);
}

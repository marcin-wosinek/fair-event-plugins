import { render } from '@wordpress/element';
import Import from './Import.js';

const rootElement = document.getElementById( 'fair-audience-import-root' );
if ( rootElement ) {
	render( <Import />, rootElement );
}

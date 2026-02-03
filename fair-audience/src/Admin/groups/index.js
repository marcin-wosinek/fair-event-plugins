import { render } from '@wordpress/element';
import Groups from './Groups.js';

const rootElement = document.getElementById( 'fair-audience-groups-root' );
if ( rootElement ) {
	render( <Groups />, rootElement );
}

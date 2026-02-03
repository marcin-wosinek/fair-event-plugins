import { render } from '@wordpress/element';
import Collaborators from './Collaborators.js';

const rootElement = document.getElementById(
	'fair-audience-collaborators-root'
);
if ( rootElement ) {
	render( <Collaborators />, rootElement );
}

import { createRoot } from '@wordpress/element';
import PollsList from './PollsList.js';

const root = document.getElementById( 'fair-audience-polls-root' );

if ( root ) {
	createRoot( root ).render( <PollsList /> );
}

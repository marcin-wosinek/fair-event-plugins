import { createRoot } from '@wordpress/element';
import FormAnswers from './FormAnswers.js';
import './style.css';

const rootElement = document.getElementById( 'fair-form-form-answers-root' );
if ( rootElement ) {
	createRoot( rootElement ).render( <FormAnswers /> );
}

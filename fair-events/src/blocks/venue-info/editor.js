/**
 * Venue Info Block
 *
 * Block for displaying a selected venue's details.
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import './style.css';

/**
 * Register the block
 */
registerBlockType( 'fair-events/venue-info', {
	/**
	 * Block edit function
	 *
	 * @param {Object} props               - Block props
	 * @param {Object} props.attributes    - Block attributes
	 * @param {Object} props.setAttributes - Attribute setter
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,
} );

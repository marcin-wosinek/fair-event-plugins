/**
 * Events Calendar Block - Editor
 *
 * @package FairEvents
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import metadata from './block.json';
import './editor.scss';
import './style.scss';

registerBlockType( metadata.name, {
	...metadata,
	edit: EditComponent,
} );

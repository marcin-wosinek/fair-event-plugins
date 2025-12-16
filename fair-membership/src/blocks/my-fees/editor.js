/**
 * My Fees Block Editor Registration
 *
 * @package FairMembership
 */

import { registerBlockType } from '@wordpress/blocks';
import Edit from './components/EditComponent.js';
import Save from './components/SaveComponent.js';
import metadata from './block.json';
import './editor.css';

registerBlockType(metadata.name, {
	edit: Edit,
	save: Save,
});

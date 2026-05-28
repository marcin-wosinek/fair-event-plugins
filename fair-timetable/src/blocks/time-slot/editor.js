/**
 * Editor script for Time Slot block
 */

import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';
import deprecations from './deprecations.js';
import './view.css';
import './editor.css';

// Register the block
wp.blocks.registerBlockType('fair-timetable/time-slot', {
	edit: EditComponent,
	save: SaveComponent,
	deprecated: deprecations,
});

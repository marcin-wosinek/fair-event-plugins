/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';

/**
 * Entry point for Fair Timetable blocks
 * Individual blocks will be imported and registered here
 */

// Import and register blocks
import './blocks/timetable';
import './blocks/time-slot';
import './blocks/time-column-body';
import './blocks/time-column';

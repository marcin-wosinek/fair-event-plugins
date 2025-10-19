/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';

/**
 * Entry point for Fair Membership blocks
 * Individual blocks are imported and registered via their editor.js files
 * This file serves as a reference but blocks are built separately via webpack
 */

// Blocks are registered via webpack entries:
// - blocks/membership-switch/editor.js
// - blocks/member-content/editor.js
// - blocks/non-member-content/editor.js

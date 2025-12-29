/**
 * Fair Team Admin Script
 * Simple script to demonstrate JavaScript translations
 */

import { __ } from '@wordpress/i18n';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
	// Test translatable string
	const welcomeMessage = __('Welcome to Team Management', 'fair-team');
	console.log(welcomeMessage);
});

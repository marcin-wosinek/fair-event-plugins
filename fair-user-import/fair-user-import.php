<?php
/**
 * Plugin Name: Fair User Import
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Import users from CSV files with optional group assignment.
 * Version: 0.1.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-user-import
 * Domain Path: /languages
 * Tested up to: 6.9
 *
 * Fair User Import is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair User Import is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair User Import. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairUserImport
 * @author Marcin Wosinek
 * @since 0.1.0
 */

namespace FairUserImport {

	defined( 'WPINC' ) || die;
	require_once __DIR__ . '/vendor/autoload.php';

	use FairUserImport\Admin\AdminHooks;
	use FairUserImport\API\RestAPI;

	/**
	 * Initialize the plugin
	 */
	function init() {
		// Initialize admin hooks.
		new AdminHooks();

		// Initialize REST API.
		new RestAPI();
	}

	// Initialize plugin.
	init();
}

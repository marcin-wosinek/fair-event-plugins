<?php
/**
 * Plugin Name: Fair Timetable
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Timetable management plugin for events & weekly activities.
 * Version: 0.8.0
 * Requires at least: 6.7
 * Requires PHP: 8.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-timetable
 * Tested up to: 7.1
 *
 * Fair Timetable is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Timetable is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Timetable. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairTimetable
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairTimetable;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';

// Every Fair plugin bundles the shared library. Each copy registers here,
// the newest is selected on plugins_loaded, and this plugin uses shared
// classes only after that (see PHP_PATTERNS.md § Shared Package).
require_once __DIR__ . '/vendor/fair-events/shared/bootstrap.php';
\Fair_Events_Shared_Loader::register(
	array(
		'plugin_file' => __FILE__,
		'package_dir' => __DIR__ . '/vendor/fair-events/shared',
		'messages'    => array( \FairTimetable\Core\SharedLibraryMessages::class, 'message' ),
	)
);

use FairTimetable\Core\Plugin;

// Initialize plugin once the shared library is selected.
\Fair_Events_Shared_Loader::when_ready(
	__FILE__,
	static function () {
		Plugin::instance()->init();
	}
);

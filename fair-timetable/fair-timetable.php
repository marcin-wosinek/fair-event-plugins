<?php
/**
 * Plugin Name: Fair Timetable
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Timetable management plugin for events & weekly activities.
 * Version: 0.6.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-timetable
 * Tested up to: 6.9
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

use FairTimetable\Core\Plugin;

Plugin::instance()->init();

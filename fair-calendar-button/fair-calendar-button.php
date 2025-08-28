<?php
/**
 * Plugin Name: Fair Calendar Button
 * Plugin URI: https://wordpress.org/plugins/fair-calendar-button/
 * Description: A Gutenberg block for calendar integration. The block displays a button with a calendar integration with support for Google Calendar, Outlook, Yahoo Calendar, and ICS downloads.
 * Version: 1.3.0
 * Requires at least: 5.8
 * Requires PHP: 8.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-calendar-button
 *
 * Fair Calendar Button is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Calendar Button is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Calendar Button. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairCalendarButton
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairCalendarButton;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';

use FairCalendarButton\Core\Plugin;

Plugin::instance()->init();

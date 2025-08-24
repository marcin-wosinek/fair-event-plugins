<?php
/**
 * Plugin Name: Fair Registration
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: A Gutenberg block plugin for registration management. The plugin provides multiple blocks for event registration with fair pricing model.
 * Version: 1.0.0
 * Requires at least: 5.8
 * Requires PHP: 8.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-registration
 *
 * Fair Registration is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Registration is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Registration. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairRegistration
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairRegistration;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';

use FairRegistration\Core\Plugin;

Plugin::instance()->init();
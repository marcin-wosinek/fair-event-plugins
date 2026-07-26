<?php
/**
 * Plugin core class for Fair Timetable
 *
 * @package FairTimetable
 */

namespace FairTimetable\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-timetable', false, 'fair-timetable/languages' );
				}
			}
		);

		add_action(
			'admin_init',
			function () {
				register_setting(
					'fair_timetable_settings',
					Features::OPTION,
					array(
						'type'              => 'object',
						'sanitize_callback' => array( Features::class, 'sanitize_option' ),
						'default'           => array(),
					)
				);
			}
		);

		$this->load_shared_settings_page();
		$this->load_hooks();
	}

	/**
	 * Boot the shared central "Fair Event Plugins" settings screen and
	 * register this plugin's bundled-translations row on it.
	 *
	 * @return void
	 */
	private function load_shared_settings_page() {
		if ( ! is_admin() ) {
			return;
		}

		if ( class_exists( '\FairEventsShared\Admin\SettingsPage' ) ) {
			\FairEventsShared\Admin\SettingsPage::boot();
		}

		add_filter( 'fair_event_plugins_settings_fields', array( $this, 'register_shared_settings_fields' ) );
	}

	/**
	 * Register this plugin's bundled-translations row on the shared screen.
	 *
	 * @param array $fields Field descriptors collected so far.
	 * @return array Field descriptors with this plugin's row appended.
	 */
	public function register_shared_settings_fields( $fields ) {
		$fields[] = array(
			'section'       => 'translations',
			'section_title' => __( 'Translations', 'fair-timetable' ),
			'id'            => 'fair-timetable/bundled-translations',
			'type'          => 'checkbox',
			'option'        => Features::OPTION,
			'key'           => 'bundled-translations',
			'label'         => __( 'Fair Timetable', 'fair-timetable' ),
			'description'   => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-timetable' ),
			'value'         => Features::is_enabled( 'bundled-translations' ),
			'locked'        => Features::is_forced( 'bundled-translations' ),
			'locked_note'   => __( 'Forced by a wp-config constant — change it there.', 'fair-timetable' ),
		);
		return $fields;
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairTimetable\Hooks\BlockHooks();
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization
	}
}

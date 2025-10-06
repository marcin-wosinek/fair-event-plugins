<?php
/**
 * Settings for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Settings;

defined( 'WPINC' ) || die;

/**
 * Settings class for registering plugin settings
 */
class Settings {
	/**
	 * Initialize settings
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register plugin settings
	 *
	 * @return void
	 */
	public function register_settings() {
		// Register event slug setting
		register_setting(
			'fair_events_settings',
			'fair_events_slug',
			array(
				'type'              => 'string',
				'description'       => __( 'URL slug for events', 'fair-events' ),
				'sanitize_callback' => 'sanitize_title',
				'show_in_rest'      => true,
				'default'           => 'fair-events',
			)
		);
	}
}

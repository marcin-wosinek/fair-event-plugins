<?php
/**
 * Settings for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Settings;

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
		register_setting(
			'fair_events_experimental_settings',
			\FairEventsExperimental\Core\Features::OPTION,
			array(
				'type'              => 'object',
				'description'       => __( 'Per-bundle feature toggles for experimental features', 'fair-events-experimental' ),
				'sanitize_callback' => array( \FairEventsExperimental\Core\Features::class, 'sanitize_option' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'                 => 'object',
						'additionalProperties' => array( 'type' => 'boolean' ),
					),
				),
				'default'           => array(),
			)
		);
	}
}

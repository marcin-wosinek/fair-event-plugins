<?php
/**
 * Facebook Settings for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Settings;

defined( 'WPINC' ) || die;

/**
 * FacebookSettings class for registering Facebook-related plugin settings
 */
class FacebookSettings {
	/**
	 * Initialize settings
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register Facebook-related plugin settings
	 *
	 * @return void
	 */
	public function register_settings() {
		// Facebook Page Access Token (hidden from REST read for security).
		register_setting(
			'fair_events_settings',
			'fair_events_facebook_access_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Facebook Page Access Token', 'fair-events' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'string',
						'context' => array( 'edit' ),
					),
				),
				'default'           => '',
			)
		);

		// Facebook Page ID.
		register_setting(
			'fair_events_settings',
			'fair_events_facebook_page_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Facebook Page ID', 'fair-events' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Facebook Page Name (for display).
		register_setting(
			'fair_events_settings',
			'fair_events_facebook_page_name',
			array(
				'type'              => 'string',
				'description'       => __( 'Facebook Page Name', 'fair-events' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Facebook Connection Status.
		register_setting(
			'fair_events_settings',
			'fair_events_facebook_connected',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Facebook Connection Status', 'fair-events' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);

		// Facebook Token Expiration (Unix timestamp).
		register_setting(
			'fair_events_settings',
			'fair_events_facebook_token_expires',
			array(
				'type'              => 'integer',
				'description'       => __( 'Facebook Token Expiration (Unix timestamp)', 'fair-events' ),
				'sanitize_callback' => 'absint',
				'show_in_rest'      => true,
				'default'           => 0,
			)
		);
	}
}

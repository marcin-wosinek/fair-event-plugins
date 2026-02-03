<?php
/**
 * Settings management for Fair Audience
 *
 * @package FairAudience
 */

namespace FairAudience\Settings;

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
		add_action( 'rest_api_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register plugin settings
	 *
	 * @return void
	 */
	public function register_settings() {
		// Instagram OAuth Access Token.
		register_setting(
			'fair_audience_settings',
			'fair_audience_instagram_access_token',
			array(
				'type'              => 'string',
				'description'       => __( 'Instagram OAuth Access Token', 'fair-audience' ),
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

		// Instagram User ID.
		register_setting(
			'fair_audience_settings',
			'fair_audience_instagram_user_id',
			array(
				'type'              => 'string',
				'description'       => __( 'Instagram User ID', 'fair-audience' ),
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

		// Instagram Username (for display).
		register_setting(
			'fair_audience_settings',
			'fair_audience_instagram_username',
			array(
				'type'              => 'string',
				'description'       => __( 'Instagram Username', 'fair-audience' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => true,
				'default'           => '',
			)
		);

		// Instagram Connection Status.
		register_setting(
			'fair_audience_settings',
			'fair_audience_instagram_connected',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Instagram Connection Status', 'fair-audience' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'boolean',
						'context' => array( 'edit' ),
					),
				),
				'default'           => false,
			)
		);

		// Instagram Token Expiration.
		register_setting(
			'fair_audience_settings',
			'fair_audience_instagram_token_expires',
			array(
				'type'              => 'integer',
				'description'       => __( 'Instagram Token Expiration (Unix timestamp)', 'fair-audience' ),
				'sanitize_callback' => 'absint',
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'integer',
						'context' => array( 'edit' ),
					),
				),
				'default'           => 0,
			)
		);
	}
}

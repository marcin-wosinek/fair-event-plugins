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

		// Registered on both hooks: REST writes need it on rest_api_init, but
		// the shared Settings → Fair Event Plugins screen (SettingsPage.php)
		// saves via a plain admin POST outside REST, so the
		// sanitize_callback must also be attached on admin_init or that
		// write path has no sanitization at all.
		add_action( 'rest_api_init', array( $this, 'register_feature_settings' ) );
		add_action( 'admin_init', array( $this, 'register_feature_settings' ) );
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

		// Mailing Category IDs.
		register_setting(
			'fair_audience_settings',
			'fair_audience_mailing_category_ids',
			array(
				'type'              => 'array',
				'description'       => __( 'Category IDs used for marketing mailing', 'fair-audience' ),
				'sanitize_callback' => function ( $value ) {
					if ( ! is_array( $value ) ) {
						return array();
					}
					return array_values( array_map( 'absint', $value ) );
				},
				'show_in_rest'      => array(
					'schema' => array(
						'type'  => 'array',
						'items' => array(
							'type' => 'integer',
						),
					),
				),
				'default'           => array(),
			)
		);
	}

	/**
	 * Register the feature-flag bundle option. Kept separate from
	 * register_settings() and hooked on both rest_api_init and admin_init —
	 * see init().
	 *
	 * @return void
	 */
	public function register_feature_settings() {
		// Feature flag bundle toggles — UI state only, never overrides a
		// wp-config constant (see Features::sanitize_option()).
		register_setting(
			'fair_audience_settings',
			\FairAudience\Core\Features::OPTION,
			array(
				'type'              => 'object',
				'description'       => __( 'Per-bundle feature toggles', 'fair-audience' ),
				'sanitize_callback' => array( \FairAudience\Core\Features::class, 'sanitize_option' ),
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

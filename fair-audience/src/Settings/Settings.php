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

		// Weekly digest configuration — single option object.
		register_setting(
			'fair_audience_settings',
			'fair_audience_weekly_digest',
			array(
				'type'              => 'object',
				'description'       => __( 'Weekly events digest configuration', 'fair-audience' ),
				'sanitize_callback' => array( \FairAudience\Services\WeeklyDigestRenderer::class, 'sanitize_config' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'       => 'object',
						'properties' => array(
							'enabled'     => array( 'type' => 'boolean' ),
							'source_slug' => array( 'type' => 'string' ),
							'day_of_week' => array( 'type' => 'integer' ),
							'time_of_day' => array( 'type' => 'string' ),
							'week_scope'  => array( 'type' => 'string' ),
							'skip_empty'  => array( 'type' => 'boolean' ),
							'subject'     => array( 'type' => 'string' ),
							'intro'       => array( 'type' => 'string' ),
						),
					),
				),
				'default'           => \FairAudience\Services\WeeklyDigestRenderer::default_config(),
			)
		);

		// Runtime-written: last ISO week ('YYYY-Www') a digest was sent for.
		register_setting(
			'fair_audience_settings',
			'fair_audience_weekly_digest_last_sent_week',
			array(
				'type'              => 'string',
				'description'       => __( 'ISO week of the last sent weekly digest', 'fair-audience' ),
				'sanitize_callback' => 'sanitize_text_field',
				'show_in_rest'      => false,
				'default'           => '',
			)
		);

		// Runtime-written: outcome of the last digest cron run.
		register_setting(
			'fair_audience_settings',
			'fair_audience_weekly_digest_last_run_result',
			array(
				'type'              => 'object',
				'description'       => __( 'Outcome of the last weekly digest cron run', 'fair-audience' ),
				'sanitize_callback' => function ( $value ) {
					return is_array( $value ) ? $value : array();
				},
				'show_in_rest'      => array(
					'schema' => array(
						'type'       => 'object',
						'properties' => array(
							'status'    => array( 'type' => 'string' ),
							'timestamp' => array( 'type' => 'string' ),
							'message'   => array( 'type' => 'string' ),
						),
					),
				),
				'default'           => array(),
			)
		);

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

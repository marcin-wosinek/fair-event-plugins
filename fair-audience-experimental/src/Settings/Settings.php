<?php
/**
 * Settings for Fair Audience Experimental
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Settings;

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
			'fair_audience_experimental_settings',
			\FairAudienceExperimental\Core\Features::OPTION,
			array(
				'type'              => 'object',
				'description'       => __( 'Per-bundle feature toggles for experimental features', 'fair-audience-experimental' ),
				'sanitize_callback' => array( \FairAudienceExperimental\Core\Features::class, 'sanitize_option' ),
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

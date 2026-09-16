<?php
/**
 * REST API Controller for reason-required connector settings writes
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\AuditLog\AuditLogger;
use FairPaymentsConnector\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * The only write path for the connector settings listed in
 * Settings::MANUALLY_WRITTEN_SETTINGS (mode, currency, bank-transfer
 * threshold). Every call requires a non-empty reason, which is recorded to
 * the audit log alongside each changed setting. The generic /wp/v2/settings
 * endpoint can no longer write these keys — see
 * Settings::lock_manual_settings_from_generic_rest_write().
 */
class SettingsWriteController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/settings',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'save_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'settings' => array(
							'type'     => 'object',
							'required' => true,
						),
						'reason'   => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_textarea_field',
							'validate_callback' => array( $this, 'validate_reason' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Capability check.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Reject an empty/whitespace-only reason.
	 *
	 * @param mixed $value Raw param value.
	 * @return bool
	 */
	public function validate_reason( $value ) {
		return is_string( $value ) && '' !== trim( $value );
	}

	/**
	 * The allowlisted connector settings this route may write, with their
	 * default value and sanitizer. Reuses Settings' own sanitizers so this
	 * route and the /wp/v2/settings registration never drift apart.
	 *
	 * @return array<string,array{default: mixed, sanitize: callable}>
	 */
	private function allowed_settings() {
		$settings = new Settings();

		return array(
			'fair_payment_mode'                           => array(
				'default'  => 'test',
				'sanitize' => array( $settings, 'sanitize_mode' ),
			),
			'fair_payment_currency'                       => array(
				'default'  => 'EUR',
				'sanitize' => array( $settings, 'sanitize_currency' ),
			),
			'fair_payment_disable_banktransfer_near_date' => array(
				'default'  => false,
				'sanitize' => 'rest_sanitize_boolean',
			),
			'fair_payment_banktransfer_threshold_days'    => array(
				'default'  => 3,
				'sanitize' => array( $settings, 'sanitize_threshold_days' ),
			),
		);
	}

	/**
	 * POST /settings
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function save_settings( $request ) {
		$reason   = trim( (string) $request->get_param( 'reason' ) );
		$settings = $request->get_param( 'settings' );

		if ( ! is_array( $settings ) || empty( $settings ) ) {
			return new WP_Error(
				'invalid_settings',
				__( 'No settings were provided.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$allowed = $this->allowed_settings();

		foreach ( array_keys( $settings ) as $key ) {
			if ( ! isset( $allowed[ $key ] ) ) {
				return new WP_Error(
					'invalid_setting',
					sprintf(
						/* translators: %s: rejected setting key */
						__( '"%s" is not an editable setting.', 'fair-payments-connector' ),
						$key
					),
					array( 'status' => 400 )
				);
			}
		}

		$actor_id = get_current_user_id();
		$changed  = array();

		foreach ( $allowed as $key => $config ) {
			if ( ! array_key_exists( $key, $settings ) ) {
				continue;
			}

			$old_value = get_option( $key, $config['default'] );
			$new_value = call_user_func( $config['sanitize'], $settings[ $key ] );

			update_option( $key, $new_value );

			// Persisting the setting and its audit entry is treated as one
			// unit: if the entry can't be stored, revert the option rather
			// than report a change as successful with no trail of it.
			$result = AuditLogger::record_setting_change( $key, $old_value, $new_value, $reason, $actor_id );
			if ( false === $result ) {
				update_option( $key, $old_value );
				return new WP_Error(
					'audit_log_failed',
					__( 'The setting change could not be recorded and was not saved. Please try again.', 'fair-payments-connector' ),
					array( 'status' => 500 )
				);
			}

			$changed[ $key ] = $new_value;
		}

		return new WP_REST_Response(
			array(
				'success'  => true,
				'settings' => $changed,
			),
			200
		);
	}
}

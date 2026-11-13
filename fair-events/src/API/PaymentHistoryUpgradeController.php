<?php
/**
 * Payment history upgrade readiness REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Services\PaymentHistoryCleanup;
use FairEvents\Services\PaymentHistoryUpgrade;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Upgrade readiness after the payment history migration
 * (PAYMENT_HISTORY_MIGRATION.md §8.17): the completion evidence and the
 * checklist behind it, the operator's staging verification, and the
 * source-history cleanup (§8.21). Kept apart
 * from PaymentHistoryController, whose migration routes are retired by
 * #2252 while these stay. Every route needs `manage_options`: 401 when
 * logged out, 403 without it.
 */
class PaymentHistoryUpgradeController extends WP_REST_Controller {

	/**
	 * Namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'payment-history/upgrade';

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$permission = array( $this, 'permissions_check' );

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_status' ),
				'permission_callback' => $permission,
			)
		);

		$versions = array();
		foreach ( array_keys( PaymentHistoryUpgrade::INTERMEDIATE_VERSIONS ) as $slug ) {
			$versions[ $slug ] = array( 'type' => array( 'string', 'null' ) );
		}
		$checks = array();
		foreach ( PaymentHistoryUpgrade::STAGING_CHECKS as $check ) {
			$checks[ $check ] = array( 'type' => 'boolean' );
		}

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/staging-verification',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'record_staging_verification' ),
				'permission_callback' => $permission,
				'args'                => array(
					'verified_on' => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'versions'    => array(
						'type'                 => 'object',
						'required'             => true,
						'properties'           => $versions,
						'additionalProperties' => false,
						'validate_callback'    => 'rest_validate_request_arg',
					),
					'checks'      => array(
						'type'                 => 'object',
						'default'              => array(),
						'properties'           => $checks,
						'additionalProperties' => false,
						'validate_callback'    => 'rest_validate_request_arg',
					),
					'note'        => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_textarea_field',
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/cleanup',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'run_cleanup' ),
				'permission_callback' => $permission,
				'args'                => array(
					'backup_confirmed' => array(
						'type'              => 'boolean',
						'default'           => false,
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);
	}

	/**
	 * Only administrators see and record upgrade readiness.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function permissions_check( $request ) {
		unset( $request );
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', __( 'You must be logged in.', 'fair-events' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You do not have permission to manage payment history.', 'fair-events' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * The completion evidence, checklist and staging verification.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_status( $request ) {
		unset( $request );
		return rest_ensure_response( PaymentHistoryUpgrade::status() );
	}

	/**
	 * Record the operator's staging verification.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function record_staging_verification( $request ) {
		$result = PaymentHistoryUpgrade::record_staging_verification(
			array(
				'verified_on' => $request->get_param( 'verified_on' ),
				'versions'    => (array) $request->get_param( 'versions' ),
				'checks'      => (array) $request->get_param( 'checks' ),
				'note'        => $request->get_param( 'note' ),
			),
			get_current_user_id(),
			current_time( 'Y-m-d' )
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( PaymentHistoryUpgrade::status() );
	}

	/**
	 * Remove the migration's own storage (PAYMENT_HISTORY_MIGRATION.md
	 * §8.21). A repeat after it ran changes nothing.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error The upgrade status with `performed`.
	 */
	public function run_cleanup( $request ) {
		$result = PaymentHistoryCleanup::run(
			array(
				'backup_confirmed' => (bool) $request->get_param( 'backup_confirmed' ),
				'user_id'          => get_current_user_id(),
			)
		);
		if ( is_wp_error( $result ) ) {
			$messages = array(
				'backup_required'        => __( 'Confirm that you took a fresh database backup before removing the old payment records.', 'fair-events' ),
				'cleanup_not_applicable' => __( 'This site has no old payment records to remove.', 'fair-events' ),
				'cleanup_blocked'        => __( 'The old payment records can’t be removed yet. Reload the page to see why.', 'fair-events' ),
				'cleanup_busy'           => __( 'The old payment records are being removed already. Try again in a moment.', 'fair-events' ),
				'cleanup_failed'         => __( 'Not all the old payment records could be removed. Nothing still in use was changed; try again to finish.', 'fair-events' ),
			);
			$code     = $result->get_error_code();
			return new WP_Error( $code, $messages[ $code ] ?? $result->get_error_message(), $result->get_error_data() );
		}
		return rest_ensure_response(
			array_merge(
				PaymentHistoryUpgrade::status(),
				array( 'performed' => (bool) $result['performed'] )
			)
		);
	}
}

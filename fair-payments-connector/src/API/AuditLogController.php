<?php
/**
 * REST API Controller for the settings/connection audit log
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\AuditLogRepository;
use FairPaymentsConnector\Models\AuditLogEntry;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Read-only REST endpoint for the audit log.
 *
 * Admin-only — even redacted rows expose who changed what and when.
 */
class AuditLogController extends WP_REST_Controller {

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
			'/audit-log',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'page'     => array(
							'type'              => 'integer',
							'default'           => 1,
							'minimum'           => 1,
							'sanitize_callback' => 'absint',
						),
						'per_page' => array(
							'type'              => 'integer',
							'default'           => 20,
							'minimum'           => 1,
							'maximum'           => 100,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Capability check.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /audit-log
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$page     = (int) $request->get_param( 'page' );
		$per_page = (int) $request->get_param( 'per_page' );

		$repo   = new AuditLogRepository();
		$result = $repo->get_entries(
			array(
				'page'     => $page,
				'per_page' => $per_page,
			)
		);

		return new WP_REST_Response(
			array(
				'items' => array_map( array( $this, 'prepare_entry' ), $result['items'] ),
				'total' => $result['total'],
				'pages' => (int) ceil( $result['total'] / $per_page ),
				'page'  => $page,
			),
			200
		);
	}

	/**
	 * Format an AuditLogEntry for the wire.
	 *
	 * @param AuditLogEntry $entry Log entry.
	 * @return array
	 */
	private function prepare_entry( AuditLogEntry $entry ) {
		$context = null;
		if ( ! empty( $entry->context ) ) {
			$decoded = json_decode( $entry->context, true );
			$context = ( JSON_ERROR_NONE === json_last_error() ) ? $decoded : null;
		}

		$actor_name = $entry->actor_user_id
			? ( $entry->actor_display_name
				? $entry->actor_display_name
				/* translators: %d: WordPress user ID */
				: sprintf( __( 'Deleted user #%d', 'fair-payments-connector' ), $entry->actor_user_id ) )
			: __( 'System', 'fair-payments-connector' );

		return array(
			'id'                 => (int) $entry->id,
			'created_at'         => $entry->created_at ? get_date_from_gmt( $entry->created_at ) : '',
			'action'             => $entry->action,
			'setting_key'        => $entry->setting_key,
			'old_value'          => $entry->is_protected ? null : $entry->old_value,
			'new_value'          => $entry->is_protected ? null : $entry->new_value,
			'is_protected'       => (bool) $entry->is_protected,
			'actor_user_id'      => $entry->actor_user_id ? (int) $entry->actor_user_id : null,
			'actor_display_name' => $actor_name,
			'reason'             => $entry->reason,
			'context'            => $context,
		);
	}
}

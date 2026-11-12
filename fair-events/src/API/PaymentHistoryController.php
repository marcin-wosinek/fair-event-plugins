<?php
/**
 * Payment history REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryReconciliation;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Ongoing payment history management for administrators
 * (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.10): availability and finding
 * counts, the findings with their reconciliation and its audit trail. The
 * one-time migration's controls are retired (#2252). Every route needs
 * `manage_options`: 401 when logged out, 403 without it.
 */
class PaymentHistoryController extends WP_REST_Controller {

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
	protected $rest_base = 'payment-history';

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$base       = '/' . $this->rest_base;
		$permission = array( $this, 'permissions_check' );
		$note       = array(
			'type'              => 'string',
			'required'          => true,
			'sanitize_callback' => 'sanitize_textarea_field',
			'validate_callback' => 'rest_validate_request_arg',
		);
		$link_ids   = array(
			'type'              => 'array',
			'items'             => array( 'type' => 'integer' ),
			'required'          => true,
			'validate_callback' => 'rest_validate_request_arg',
		);
		$id         = array(
			'type'              => 'integer',
			'required'          => true,
			'sanitize_callback' => 'absint',
			'validate_callback' => static fn( $value ) => is_numeric( $value ) && (int) $value > 0,
		);

		register_rest_route(
			$this->namespace,
			$base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_status' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/findings',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_findings' ),
				'permission_callback' => $permission,
				'args'                => array(
					'mode'               => array(
						'type'              => 'string',
						'enum'              => array( PaymentHistoryFinding::MODE_BACKFILL, PaymentHistoryFinding::MODE_DRY_RUN ),
						'default'           => PaymentHistoryFinding::MODE_BACKFILL,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'status'             => array(
						'type'              => 'string',
						'enum'              => array( '', 'all', PaymentHistoryFinding::STATUS_OPEN, PaymentHistoryFinding::STATUS_RESOLVED, PaymentHistoryFinding::STATUS_RECONCILED, PaymentHistoryFinding::STATUS_REVIEWED, 'decided' ),
						'default'           => PaymentHistoryFinding::STATUS_OPEN,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'reason'             => array(
						'type'              => 'string',
						'enum'              => array_merge( array( '' ), PaymentHistoryFinding::REASONS ),
						'default'           => '',
						'validate_callback' => 'rest_validate_request_arg',
					),
					'event_date_id'      => array(
						'type'              => 'integer',
						'minimum'           => -1,
						'default'           => -1,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'source_type'        => array(
						'type'              => 'string',
						'enum'              => array( '', PaymentHistoryFinding::SOURCE_TRANSACTION, PaymentHistoryFinding::SOURCE_RELATIONSHIP, PaymentHistoryFinding::SOURCE_LEDGER_ROW, PaymentHistoryFinding::SOURCE_SIGNUP, PaymentHistoryFinding::SOURCE_LINK ),
						'default'           => '',
						'validate_callback' => 'rest_validate_request_arg',
					),
					'source_id'          => array(
						'type'              => 'integer',
						'minimum'           => 0,
						'default'           => 0,
						'validate_callback' => 'rest_validate_request_arg',
					),
					// The finding's Connector transaction, independently of the run's `mode`.
					'transaction_status' => array(
						'description'       => 'Any of these current statuses; empty for any.',
						'type'              => 'array',
						'items'             => array(
							'type' => 'string',
							'enum' => PaymentHistoryFinding::TRANSACTION_STATUSES,
						),
						'default'           => array(),
						'validate_callback' => 'rest_validate_request_arg',
					),
					'payment_mode'       => array(
						'type'              => 'string',
						'enum'              => PaymentHistoryFinding::PAYMENT_MODE_VALUES,
						'default'           => PaymentHistoryFinding::FILTER_ALL,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'page'               => $this->page_arg(),
					'per_page'           => $this->per_page_arg(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/findings/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_finding' ),
				'permission_callback' => $permission,
				'args'                => array( 'id' => $id ),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/findings/(?P<id>\d+)/links',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'link_finding' ),
				'permission_callback' => $permission,
				'args'                => array(
					'id'                => $id,
					'note'              => $note,
					'expected_link_ids' => $link_ids,
					'links'             => array(
						'type'              => 'array',
						'required'          => true,
						'minItems'          => 1,
						'maxItems'          => 50,
						'items'             => array(
							'type'       => 'object',
							'properties' => array(
								'signup_id'        => array(
									'type'     => 'integer',
									'minimum'  => 1,
									'required' => true,
								),
								'role'             => array(
									'type' => 'string',
									'enum' => PaymentHistoryReconciliation::ROLES,
								),
								'allocated_amount' => array(
									'type'     => 'number',
									'minimum'  => 0,
									'required' => true,
								),
							),
						),
						// Hand-written args don't enforce the schema bounds on their own.
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/findings/(?P<id>\d+)/review',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'review_finding' ),
				'permission_callback' => $permission,
				'args'                => array(
					'id'   => $id,
					'note' => $note,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/links/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => array( $this, 'unlink' ),
				'permission_callback' => $permission,
				'args'                => array(
					'id'                => $id,
					'note'              => $note,
					'expected_link_ids' => $link_ids,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/purchases',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'search_purchases' ),
				'permission_callback' => $permission,
				'args'                => array(
					'search'        => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'event_date_id' => array(
						'type'              => 'integer',
						'minimum'           => 0,
						'default'           => 0,
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/audit',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_audit' ),
				'permission_callback' => $permission,
				'args'                => array(
					'finding_id'     => array(
						'type'              => 'integer',
						'minimum'           => 0,
						'default'           => 0,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'transaction_id' => array(
						'type'              => 'integer',
						'minimum'           => 0,
						'default'           => 0,
						'validate_callback' => 'rest_validate_request_arg',
					),
					'page'           => $this->page_arg(),
					'per_page'       => $this->per_page_arg(),
				),
			)
		);
	}

	/**
	 * Only administrators see and change payment history.
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
	 * Whether payment history can be managed on this site, and how many
	 * findings there are per status.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_status( $request ) {
		unset( $request );
		return rest_ensure_response(
			array(
				'reconciliation_available' => PaymentHistoryCompatibility::reconciliation_available(),
				'payment_information'      => PaymentHistoryCompatibility::payment_information_available() ? 'available' : 'unavailable',
				'finding_statuses'         => null === $this->require_tables() ? PaymentHistoryFinding::count_by_status( PaymentHistoryFinding::MODE_BACKFILL ) : array(),
			)
		);
	}

	/**
	 * Findings, filtered, with the event dates and reasons to filter by.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_findings( $request ) {
		$unavailable = $this->require_tables();
		if ( $unavailable ) {
			return $unavailable;
		}

		$mode     = (string) $request['mode'];
		$status   = $this->statuses( (string) $request['status'] );
		$per_page = (int) $request['per_page'];
		$filters  = array(
			'status'               => $status,
			'reason'               => (string) $request['reason'],
			'source_type'          => (string) $request['source_type'],
			'transaction_statuses' => (array) $request['transaction_status'],
			'payment_mode'         => (string) $request['payment_mode'],
		);
		if ( (int) $request['source_id'] > 0 ) {
			$filters['source_id'] = (int) $request['source_id'];
		}
		if ( (int) $request['event_date_id'] >= 0 ) {
			$filters['event_date_id'] = (int) $request['event_date_id'];
		}

		$total = PaymentHistoryFinding::count( $mode, $filters );
		$rows  = PaymentHistoryFinding::query(
			$mode,
			$filters + array(
				'limit'  => $per_page,
				'offset' => ( (int) $request['page'] - 1 ) * $per_page,
			)
		);

		$facets = PaymentHistoryFinding::facets( $mode, $status );
		$labels = PaymentHistoryReconciliation::event_date_labels( array_keys( $facets['event_dates'] ) );
		$dates  = array();
		foreach ( $facets['event_dates'] as $event_date_id => $count ) {
			$dates[] = array(
				'id'         => (int) $event_date_id,
				'count'      => $count,
				'event_date' => $labels[ $event_date_id ] ?? null,
			);
		}

		$response = $this->paged( array_map( array( PaymentHistoryReconciliation::class, 'describe_finding' ), $rows ), $total, $per_page );
		$data     = $response->get_data();
		$response->set_data(
			array(
				'items'       => $data,
				'event_dates' => $dates,
				'reasons'     => $facets['reasons'],
			)
		);
		return $response;
	}

	/**
	 * One finding with what reconciling it needs.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_finding( $request ) {
		$unavailable = $this->require_tables();
		if ( $unavailable ) {
			return $unavailable;
		}
		$context = PaymentHistoryReconciliation::context( (int) $request['id'] );
		return is_wp_error( $context ) ? $context : rest_ensure_response( $context );
	}

	/**
	 * Link a finding's transaction to purchases.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function link_finding( $request ) {
		$result = PaymentHistoryReconciliation::link(
			(int) $request['id'],
			(array) $request['links'],
			$this->decision_args( $request )
		);
		return $this->decision_result( $result, (int) $request['id'] );
	}

	/**
	 * Mark a finding as reviewed without a link.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function review_finding( $request ) {
		$result = PaymentHistoryReconciliation::review( (int) $request['id'], $this->decision_args( $request ) );
		return $this->decision_result( $result, (int) $request['id'] );
	}

	/**
	 * Remove a reconciled link.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function unlink( $request ) {
		$result = PaymentHistoryReconciliation::unlink( (int) $request['id'], $this->decision_args( $request ) );
		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	/**
	 * Purchases to link a transaction to.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function search_purchases( $request ) {
		return rest_ensure_response( PaymentHistoryReconciliation::search_purchases( (string) $request['search'], (int) $request['event_date_id'] ) );
	}

	/**
	 * Audit records, newest first.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_audit( $request ) {
		if ( ! PaymentHistoryCompatibility::reconciliation_available() ) {
			return $this->unavailable();
		}
		$per_page = (int) $request['per_page'];
		$filters  = array(
			'finding_id'     => (int) $request['finding_id'],
			'transaction_id' => (int) $request['transaction_id'],
		);
		return $this->paged(
			PaymentHistoryReconciliation::describe_audit(
				PaymentHistoryAudit::query(
					$filters + array(
						'limit'  => $per_page,
						'offset' => ( (int) $request['page'] - 1 ) * $per_page,
					)
				)
			),
			PaymentHistoryAudit::count( $filters ),
			$per_page
		);
	}

	/**
	 * Arguments every decision takes.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array
	 */
	private function decision_args( $request ) {
		return array(
			'note'              => (string) $request['note'],
			'expected_link_ids' => (array) ( $request['expected_link_ids'] ?? array() ),
			'user_id'           => get_current_user_id(),
		);
	}

	/**
	 * A decision's outcome with the finding's refreshed context.
	 *
	 * @param array|WP_Error $result     Outcome.
	 * @param int            $finding_id Finding ID.
	 * @return WP_REST_Response|WP_Error
	 */
	private function decision_result( $result, $finding_id ) {
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$context = PaymentHistoryReconciliation::context( $finding_id );
		return rest_ensure_response(
			array(
				'audit_id' => $result['audit_id'],
				'context'  => is_wp_error( $context ) ? null : $context,
			)
		);
	}

	/**
	 * Finding statuses a filter value stands for.
	 *
	 * @param string $status Filter value.
	 * @return string[] Empty for any.
	 */
	private function statuses( $status ) {
		if ( 'decided' === $status ) {
			return PaymentHistoryFinding::DECIDED;
		}
		return in_array( $status, array( '', 'all' ), true ) ? array() : array( $status );
	}

	/**
	 * An error when the findings tables aren't installed yet.
	 *
	 * @return WP_Error|null
	 */
	private function require_tables() {
		if ( PaymentHistoryCompatibility::storage_available()
			&& version_compare( \FairEvents\Database\Schema::get_db_version(), PaymentHistoryCompatibility::BACKFILL_DB_VERSION, '>=' )
		) {
			return null;
		}
		return $this->unavailable();
	}

	/**
	 * Payment history storage isn't installed yet.
	 *
	 * @return WP_Error
	 */
	private function unavailable() {
		return new WP_Error( 'payment_history_unavailable', __( 'Payment history isn\'t available until Fair Events finishes its database update.', 'fair-events' ), array( 'status' => 503 ) );
	}

	/**
	 * A page of items with the WordPress pagination headers.
	 *
	 * @param array $items    Items.
	 * @param int   $total    Total matching.
	 * @param int   $per_page Page size.
	 * @return WP_REST_Response
	 */
	private function paged( array $items, $total, $per_page ) {
		$response = rest_ensure_response( array_values( $items ) );
		$response->header( 'X-WP-Total', (string) (int) $total );
		$response->header( 'X-WP-TotalPages', (string) max( 1, (int) ceil( $total / max( 1, $per_page ) ) ) );
		return $response;
	}

	/**
	 * The `page` argument.
	 *
	 * @return array
	 */
	private function page_arg() {
		return array(
			'type'              => 'integer',
			'minimum'           => 1,
			'default'           => 1,
			'validate_callback' => 'rest_validate_request_arg',
		);
	}

	/**
	 * The `per_page` argument.
	 *
	 * @return array
	 */
	private function per_page_arg() {
		return array(
			'type'              => 'integer',
			'minimum'           => 1,
			'maximum'           => 100,
			'default'           => 20,
			'validate_callback' => 'rest_validate_request_arg',
		);
	}
}

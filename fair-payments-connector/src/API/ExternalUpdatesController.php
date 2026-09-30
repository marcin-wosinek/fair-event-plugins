<?php
/**
 * REST API Controller for the External Updates operation log
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\ExternalUpdateRunRepository;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Services\ExternalUpdateRuns;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Starts, finishes and lists External Updates runs (#1695).
 *
 * Admin-only. The work itself stays on the existing action endpoints, which
 * accept the run ID returned here.
 */
class ExternalUpdatesController extends WP_REST_Controller {

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
			'/external-updates/runs',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'permissions_check' ),
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
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'action'    => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => array_keys( ExternalUpdateRuns::actions() ),
						),
						'source_id' => array(
							'type'              => 'string',
							'default'           => '',
							'pattern'           => '^[a-z0-9]{0,20}$',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/external-updates/runs/(?P<id>\d+)/finish',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'finish_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Capability check for every route.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /external-updates/runs — newest first, stale runs marked interrupted.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		ExternalUpdateRuns::interrupt_stale();

		$page     = (int) $request->get_param( 'page' );
		$per_page = (int) $request->get_param( 'per_page' );
		$result   = ( new ExternalUpdateRunRepository() )->get_page( $page, $per_page );

		return new WP_REST_Response(
			array(
				'items' => array_map( array( ExternalUpdateRuns::class, 'prepare_for_response' ), $result['items'] ),
				'total' => $result['total'],
				'pages' => (int) ceil( $result['total'] / $per_page ),
				'page'  => $page,
			),
			200
		);
	}

	/**
	 * POST /external-updates/runs — start a run before any work begins.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$action    = (string) $request->get_param( 'action' );
		$source_id = (string) $request->get_param( 'source_id' );
		$label     = '';
		$ids       = null;

		switch ( $action ) {
			case ExternalUpdateRuns::ACTION_IMPORT_MOLLIE_PAYMENTS:
				if ( ! in_array( $source_id, array( 'live', 'test' ), true ) ) {
					return new WP_Error( 'invalid_mode', __( 'Choose live or test mode.', 'fair-payments-connector' ), array( 'status' => 400 ) );
				}
				if ( ! MolliePaymentHandler::is_configured() ) {
					return new WP_Error( 'mollie_not_connected', __( 'Connect Mollie before importing payments.', 'fair-payments-connector' ), array( 'status' => 400 ) );
				}
				break;

			case ExternalUpdateRuns::ACTION_LOAD_MISSING_FEES:
				if ( ! in_array( $source_id, array( '', 'all', 'live', 'test' ), true ) ) {
					return new WP_Error( 'invalid_mode', __( 'Choose live, test, or all modes.', 'fair-payments-connector' ), array( 'status' => 400 ) );
				}
				$source_id = in_array( $source_id, array( 'live', 'test' ), true ) ? $source_id : 'all';
				$ids       = Transaction::get_ids_missing_mollie_fee( 'all' === $source_id ? '' : $source_id );
				break;

			case ExternalUpdateRuns::ACTION_IMPORT_CONNECTED_SITE:
				/**
				 * Resolve a connected site for an External Updates run.
				 *
				 * Fair Payments Connector Experimental owns connected sites and
				 * returns `array( 'label' => … )` for an enabled site, or a
				 * WP_Error (404 unknown, 403 disabled). Without a listener the
				 * source is unavailable.
				 *
				 * @param array|WP_Error|null $site    Resolved site, error, or null.
				 * @param int                 $site_id Requested connected site ID.
				 */
				$site = apply_filters( 'fair_payments_connector_external_update_connected_site', null, absint( $source_id ) );
				if ( is_wp_error( $site ) ) {
					return $site;
				}
				if ( ! is_array( $site ) || ! absint( $source_id ) ) {
					return new WP_Error(
						'external_update_source_unavailable',
						__( 'Connected sites are not available. Activate Fair Payments Connector Experimental to import from them.', 'fair-payments-connector' ),
						array( 'status' => 400 )
					);
				}
				$source_id = (string) absint( $source_id );
				$label     = (string) ( $site['label'] ?? '' );
				break;
		}

		$run = ExternalUpdateRuns::start(
			array(
				'action'         => $action,
				'source_id'      => $source_id,
				'source_label'   => $label,
				'user_id'        => get_current_user_id(),
				'expected_total' => null === $ids ? null : count( $ids ),
			)
		);

		if ( is_wp_error( $run ) ) {
			return $run;
		}

		// Nothing to sync is still a finished, logged run.
		if ( array() === $ids ) {
			$run = ExternalUpdateRuns::finish( (int) $run['id'] );
		}

		$data = array( 'run' => ExternalUpdateRuns::prepare_for_response( $run ) );
		if ( null !== $ids ) {
			$data['ids'] = $ids;
		}

		return new WP_REST_Response( $data, 201 );
	}

	/**
	 * POST /external-updates/runs/{id}/finish — close a multi-request run.
	 *
	 * Only the fee action spans several requests. The server derives the
	 * outcome from its own counts; batches that never reached it count as
	 * failed.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function finish_item( $request ) {
		$run = ExternalUpdateRuns::claim( (int) $request->get_param( 'id' ), ExternalUpdateRuns::ACTION_LOAD_MISSING_FEES );
		if ( is_wp_error( $run ) ) {
			return $run;
		}

		$processed = (int) $run['updated_count'] + (int) $run['failed_count'];
		$missing   = max( 0, (int) $run['expected_total'] - $processed );
		$finished  = ExternalUpdateRuns::finish( (int) $run['id'], $missing > 0 ? 'incomplete' : null, $missing );

		return new WP_REST_Response( array( 'run' => ExternalUpdateRuns::prepare_for_response( $finished ) ), 200 );
	}
}

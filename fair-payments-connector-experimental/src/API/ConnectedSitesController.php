<?php
/**
 * Admin REST API controller for connected sites.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnectorExperimental\Models\ConnectedSite;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Services\ExternalUpdateRuns;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles admin endpoints for managing connected sites.
 */
class ConnectedSitesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the admin connected-sites routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$args = array(
			'label'     => array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'base_url'  => array(
				'type'              => 'string',
				'sanitize_callback' => 'esc_url_raw',
			),
			'token'     => array(
				'type' => 'string',
			),
			// Not `required`, and no `default`, so an explicit null (clear
			// the association) is distinguishable from the key being absent
			// (leave it untouched) via WP_REST_Request::has_param().
			'budget_id' => array(
				'description' => __( 'Linked Fair Finance budget id, or null to clear the association.', 'fair-payments-connector-experimental' ),
				'type'        => array( 'integer', 'null' ),
			),
		);

		// Not `required` and no `default`, so an omitted value leaves the
		// current setting alone via WP_REST_Request::has_param() — only used
		// on update; a newly created site is always enabled.
		$update_args            = $args;
		$update_args['enabled'] = array(
			'description' => __( 'Whether the site is available as an import source.', 'fair-payments-connector-experimental' ),
			'type'        => 'boolean',
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $update_args,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites/(?P<id>\d+)/test',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'test_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/connected-sites/(?P<id>\d+)/import-transactions',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_transactions' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'run_id' => array(
							'description'       => __( 'External Updates run this request belongs to.', 'fair-payments-connector-experimental' ),
							'type'              => 'integer',
							'default'           => 0,
							'minimum'           => 0,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Admin capability check for all routes.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * List all connected sites.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$data = array_map(
			array( ConnectedSite::class, 'to_array' ),
			ConnectedSite::get_all()
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a new connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$label     = (string) $request->get_param( 'label' );
		$base_url  = (string) $request->get_param( 'base_url' );
		$token     = (string) $request->get_param( 'token' );
		$budget_id = $request->get_param( 'budget_id' );

		if ( '' === trim( $label ) || '' === trim( $base_url ) || '' === trim( $token ) ) {
			return new WP_Error(
				'rest_invalid_connected_site',
				__( 'Label, base URL and token are all required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		if ( ! empty( $budget_id ) && ! self::budget_exists( $budget_id ) ) {
			return $this->invalid_budget();
		}

		$record = ConnectedSite::create(
			array(
				'label'     => $label,
				'base_url'  => $base_url,
				'token'     => $token,
				'budget_id' => $budget_id,
			)
		);

		return new WP_REST_Response( ConnectedSite::to_array( $record ), 201 );
	}

	/**
	 * Update a connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		if ( ! ConnectedSite::get_by_id( $id ) ) {
			return $this->not_found();
		}

		$data = array();
		if ( null !== $request->get_param( 'label' ) ) {
			$data['label'] = (string) $request->get_param( 'label' );
		}
		if ( null !== $request->get_param( 'base_url' ) ) {
			$data['base_url'] = (string) $request->get_param( 'base_url' );
		}
		if ( null !== $request->get_param( 'token' ) ) {
			$data['token'] = (string) $request->get_param( 'token' );
		}
		if ( $request->has_param( 'budget_id' ) ) {
			$budget_id = $request->get_param( 'budget_id' );
			if ( ! empty( $budget_id ) && ! self::budget_exists( $budget_id ) ) {
				return $this->invalid_budget();
			}
			$data['budget_id'] = $budget_id;
		}
		if ( $request->has_param( 'enabled' ) ) {
			$data['enabled'] = (bool) $request->get_param( 'enabled' );
		}

		$record = ConnectedSite::update( $id, $data );

		return new WP_REST_Response( ConnectedSite::to_array( $record ), 200 );
	}

	/**
	 * Delete a connected site.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		if ( ! ConnectedSite::get_by_id( $id ) ) {
			return $this->not_found();
		}

		ConnectedSite::delete( $id );

		return new WP_REST_Response( array( 'deleted' => true ), 200 );
	}

	/**
	 * Test a connected site's token against its remote /external/me endpoint.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function test_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$record = ConnectedSite::get_by_id( $id );

		if ( ! $record ) {
			return $this->not_found();
		}

		$url = trailingslashit( $record['base_url'] ) . 'wp-json/fair-payments-connector/v1/external/me';

		$response = wp_safe_remote_get(
			$url,
			array(
				'timeout' => 10,
				'headers' => array(
					'Authorization' => 'Bearer ' . $record['token'],
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			ConnectedSite::mark_failed( $id );

			return new WP_Error(
				'rest_connected_site_unreachable',
				__( 'Could not reach the remote site.', 'fair-payments-connector-experimental' ),
				array( 'status' => 502 )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $body ) ) {
			ConnectedSite::mark_failed( $id );

			$message = 401 === $code || 403 === $code
				? __( 'The remote site rejected the token.', 'fair-payments-connector-experimental' )
				: __( 'The remote site returned an unexpected response.', 'fair-payments-connector-experimental' );

			return new WP_Error(
				'rest_connected_site_test_failed',
				$message,
				array( 'status' => 400 )
			);
		}

		$scopes = isset( $body['scopes'] ) && is_array( $body['scopes'] ) ? $body['scopes'] : array();
		ConnectedSite::record_test_result( $id, $scopes );

		return new WP_REST_Response(
			array(
				'ok'     => true,
				'label'  => isset( $body['label'] ) ? sanitize_text_field( $body['label'] ) : '',
				'scopes' => array_values( array_map( 'sanitize_text_field', $scopes ) ),
			),
			200
		);
	}

	/**
	 * Resolve a connected site for an External Updates run.
	 *
	 * Hooked to `fair_payments_connector_external_update_connected_site`.
	 *
	 * @param array|WP_Error|null $site    Value from earlier listeners.
	 * @param int                 $site_id Connected site ID.
	 * @return array|WP_Error Label of an enabled site, or an error.
	 */
	public static function resolve_external_update_source( $site, $site_id ) {
		$record = ConnectedSite::get_by_id( (int) $site_id );

		if ( ! $record ) {
			return new WP_Error(
				'rest_connected_site_not_found',
				__( 'Connected site not found.', 'fair-payments-connector-experimental' ),
				array( 'status' => 404 )
			);
		}

		if ( ! ConnectedSite::is_enabled( $record ) ) {
			return self::disabled_error();
		}

		return array( 'label' => (string) $record['label'] );
	}

	/**
	 * Pull transactions from a connected site and import them locally.
	 *
	 * With a `run_id` from Fair Payments Connector's External Updates page,
	 * counts are recorded on that run after every page, and the run is
	 * closed as succeeded, partial or failed.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_transactions( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$run_id = (int) $request->get_param( 'run_id' );

		if ( $run_id ) {
			if ( ! class_exists( ExternalUpdateRuns::class ) ) {
				return new WP_Error(
					'rest_external_update_unavailable',
					__( 'Update Fair Payments Connector to record this import in the External Updates log.', 'fair-payments-connector-experimental' ),
					array( 'status' => 400 )
				);
			}

			$run = ExternalUpdateRuns::claim( $run_id, ExternalUpdateRuns::ACTION_IMPORT_CONNECTED_SITE, (string) $id );
			if ( is_wp_error( $run ) ) {
				return $run;
			}
		}

		$record = ConnectedSite::get_by_id( $id );

		if ( ! $record ) {
			return $this->fail_run( $run_id, 'source_unavailable', $this->not_found() );
		}

		if ( ! ConnectedSite::is_enabled( $record ) ) {
			return $this->fail_run( $run_id, 'source_unavailable', self::disabled_error() );
		}

		$source_domain = (string) wp_parse_url( $record['base_url'], PHP_URL_HOST );
		$base          = trailingslashit( $record['base_url'] ) . 'wp-json/fair-payments-connector/v1/external/transactions';
		$per_page      = 200;
		$page          = 1;
		$created       = 0;
		$updated       = 0;
		$skipped       = 0;

		do {
			$url = add_query_arg(
				array(
					'page'     => $page,
					'per_page' => $per_page,
				),
				$base
			);

			$response = wp_safe_remote_get(
				$url,
				array(
					'timeout' => 30,
					'headers' => array(
						'Authorization' => 'Bearer ' . $record['token'],
					),
				)
			);

			if ( is_wp_error( $response ) ) {
				ConnectedSite::mark_failed( $id );

				return $this->fail_run(
					$run_id,
					'remote_unreachable',
					$this->import_error(
						'rest_connected_site_unreachable',
						__( 'Could not reach the remote site.', 'fair-payments-connector-experimental' ),
						502,
						$record,
						array( $created, $updated, $skipped )
					)
				);
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( 200 !== $code || ! is_array( $body ) || ! isset( $body['transactions'] ) ) {
				ConnectedSite::mark_failed( $id );

				$rejected = 401 === $code || 403 === $code;
				$message  = $rejected
					? __( 'The remote site rejected the token, or it lacks the transactions:read scope.', 'fair-payments-connector-experimental' )
					: __( 'The remote site returned an unexpected response.', 'fair-payments-connector-experimental' );

				return $this->fail_run(
					$run_id,
					$rejected ? 'remote_rejected' : 'remote_invalid_response',
					$this->import_error(
						'rest_connected_site_import_failed',
						$message,
						400,
						$record,
						array( $created, $updated, $skipped )
					)
				);
			}

			$transactions = is_array( $body['transactions'] ) ? $body['transactions'] : array();
			$page_counts  = array(
				'created' => 0,
				'updated' => 0,
				'skipped' => 0,
			);

			foreach ( $transactions as $transaction ) {
				if ( ! is_array( $transaction ) ) {
					++$page_counts['skipped'];
					continue;
				}

				$result = Transaction::import(
					array(
						'mollie_payment_id' => $transaction['mollie_payment_id'] ?? '',
						'amount'            => $transaction['amount'] ?? 0,
						'currency'          => $transaction['currency'] ?? 'EUR',
						'application_fee'   => $transaction['application_fee'] ?? null,
						'status'            => $transaction['status'] ?? 'paid',
						'testmode'          => ! empty( $transaction['testmode'] ),
						'description'       => $transaction['description'] ?? '',
						'created_at'        => $transaction['created_at'] ?? '',
						'event_date_id'     => $transaction['event_date_id'] ?? null,
						'detail_url'        => $transaction['event_url'] ?? '',
						'source_domain'     => $source_domain,
						// The exact local Connected Site id, not the mutable
						// label/URL/domain above: identity used to resolve a
						// reconciliation budget must survive a site being
						// renamed or re-pointed at a different URL.
						'connected_site_id' => $id,
					)
				);

				if ( 'created' === $result ) {
					++$page_counts['created'];
				} elseif ( 'updated' === $result ) {
					++$page_counts['updated'];
				} else {
					++$page_counts['skipped'];
				}
			}

			$created += $page_counts['created'];
			$updated += $page_counts['updated'];
			$skipped += $page_counts['skipped'];

			if ( $run_id ) {
				ExternalUpdateRuns::record( $run_id, $page_counts );
			}

			$total    = isset( $body['total'] ) ? (int) $body['total'] : 0;
			$fetched  = $page * $per_page;
			$has_more = count( $transactions ) === $per_page && $fetched < $total;
			++$page;
		} while ( $has_more );

		$data = array(
			'created' => $created,
			'updated' => $updated,
			'skipped' => $skipped,
			'message' => sprintf(
				/* translators: 1: created count, 2: updated count, 3: skipped count, 4: connected site label */
				__( 'Imported %1$d new, updated %2$d, skipped %3$d transaction(s) from %4$s.', 'fair-payments-connector-experimental' ),
				$created,
				$updated,
				$skipped,
				$record['label']
			),
		);

		if ( $run_id ) {
			$data['run'] = ExternalUpdateRuns::prepare_for_response( ExternalUpdateRuns::finish( $run_id ) );
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Build an import error that says how much was imported before it.
	 *
	 * @param string $code    Error code.
	 * @param string $reason  Why the import stopped.
	 * @param int    $status  HTTP status.
	 * @param array  $record  Connected site record.
	 * @param int[]  $counts  Created, updated and skipped so far.
	 * @return WP_Error
	 */
	private function import_error( $code, $reason, $status, array $record, array $counts ) {
		list( $created, $updated, $skipped ) = $counts;

		$message = $reason;
		if ( $created + $updated + $skipped > 0 ) {
			$message = sprintf(
				/* translators: 1: connected site label, 2: created count, 3: updated count, 4: skipped count, 5: reason the import stopped */
				__( 'The import from %1$s stopped after %2$d new, %3$d updated and %4$d skipped transaction(s). %5$s', 'fair-payments-connector-experimental' ),
				$record['label'],
				$created,
				$updated,
				$skipped,
				$reason
			);
		}

		return new WP_Error(
			$code,
			$message,
			array(
				'status'  => $status,
				'created' => $created,
				'updated' => $updated,
				'skipped' => $skipped,
			)
		);
	}

	/**
	 * Close a run with a failure category, then return the request error.
	 *
	 * @param int      $run_id     Run ID, or 0.
	 * @param string   $error_code Safe failure category.
	 * @param WP_Error $error      Error to return.
	 * @return WP_Error
	 */
	private function fail_run( $run_id, $error_code, WP_Error $error ) {
		if ( $run_id ) {
			$run = ExternalUpdateRuns::finish( $run_id, $error_code );
			$error->add_data(
				array_merge(
					(array) $error->get_error_data(),
					array( 'run' => ExternalUpdateRuns::prepare_for_response( $run ) )
				)
			);
		}

		return $error;
	}

	/**
	 * Error for a disabled connected site.
	 *
	 * @return WP_Error
	 */
	private static function disabled_error() {
		return new WP_Error(
			'rest_connected_site_disabled',
			__( 'This connected site is disabled and cannot be used to import transactions.', 'fair-payments-connector-experimental' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Standard 404 error.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'rest_connected_site_not_found',
			__( 'Connected site not found.', 'fair-payments-connector-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Whether a budget id identifies an existing Fair Finance budget.
	 *
	 * When Fair Finance isn't active there is nothing to validate against;
	 * the id is accepted and simply resolves to no budget everywhere it's
	 * read until Fair Finance (and the referenced budget) exist.
	 *
	 * @param int $budget_id Budget id.
	 * @return bool
	 */
	private static function budget_exists( $budget_id ) {
		if ( ! class_exists( '\FairFinance\Models\Budget' ) ) {
			return true;
		}

		return (bool) \FairFinance\Models\Budget::get_by_id( (int) $budget_id );
	}

	/**
	 * Standard error for a budget id that doesn't identify an existing budget.
	 *
	 * @return WP_Error
	 */
	private function invalid_budget() {
		return new WP_Error(
			'rest_invalid_budget',
			__( 'Budget not found.', 'fair-payments-connector-experimental' ),
			array( 'status' => 400 )
		);
	}
}

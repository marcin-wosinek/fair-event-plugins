<?php
/**
 * Admin REST API controller for connected sites.
 *
 * Admin-only CRUD plus a connection test for the data sharing consumer side:
 * the remote sites this site pulls transaction data from.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Models\ConnectedSite;
use FairPaymentsConnector\Models\Transaction;
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
			'label'    => array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'base_url' => array(
				'type'              => 'string',
				'sanitize_callback' => 'esc_url_raw',
			),
			'token'    => array(
				'type' => 'string',
			),
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
					'args'                => $args,
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
		$label    = (string) $request->get_param( 'label' );
		$base_url = (string) $request->get_param( 'base_url' );
		$token    = (string) $request->get_param( 'token' );

		if ( '' === trim( $label ) || '' === trim( $base_url ) || '' === trim( $token ) ) {
			return new WP_Error(
				'rest_invalid_connected_site',
				__( 'Label, base URL and token are all required.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$record = ConnectedSite::create(
			array(
				'label'    => $label,
				'base_url' => $base_url,
				'token'    => $token,
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
				__( 'Could not reach the remote site.', 'fair-payments-connector' ),
				array( 'status' => 502 )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $body ) ) {
			ConnectedSite::mark_failed( $id );

			$message = 401 === $code || 403 === $code
				? __( 'The remote site rejected the token.', 'fair-payments-connector' )
				: __( 'The remote site returned an unexpected response.', 'fair-payments-connector' );

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
	 * Pull transactions from a connected site and import them locally.
	 *
	 * Paginates through the remote /external/transactions endpoint using the
	 * stored bearer token, maps each row to the local import shape, and runs it
	 * through Transaction::import (which deduplicates by mollie_payment_id).
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_transactions( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$record = ConnectedSite::get_by_id( $id );

		if ( ! $record ) {
			return $this->not_found();
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

				return new WP_Error(
					'rest_connected_site_unreachable',
					__( 'Could not reach the remote site.', 'fair-payments-connector' ),
					array( 'status' => 502 )
				);
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( 200 !== $code || ! is_array( $body ) || ! isset( $body['transactions'] ) ) {
				ConnectedSite::mark_failed( $id );

				$message = 401 === $code || 403 === $code
					? __( 'The remote site rejected the token, or it lacks the transactions:read scope.', 'fair-payments-connector' )
					: __( 'The remote site returned an unexpected response.', 'fair-payments-connector' );

				return new WP_Error(
					'rest_connected_site_import_failed',
					$message,
					array( 'status' => 400 )
				);
			}

			$transactions = is_array( $body['transactions'] ) ? $body['transactions'] : array();

			foreach ( $transactions as $transaction ) {
				if ( ! is_array( $transaction ) ) {
					++$skipped;
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
					)
				);

				if ( 'created' === $result ) {
					++$created;
				} elseif ( 'updated' === $result ) {
					++$updated;
				} else {
					++$skipped;
				}
			}

			$total    = isset( $body['total'] ) ? (int) $body['total'] : 0;
			$fetched  = $page * $per_page;
			$has_more = count( $transactions ) === $per_page && $fetched < $total;
			++$page;
		} while ( $has_more );

		return new WP_REST_Response(
			array(
				'created' => $created,
				'updated' => $updated,
				'skipped' => $skipped,
				'message' => sprintf(
					/* translators: 1: created count, 2: updated count, 3: skipped count, 4: connected site label */
					__( 'Imported %1$d new, updated %2$d, skipped %3$d transaction(s) from %4$s.', 'fair-payments-connector' ),
					$created,
					$updated,
					$skipped,
					$record['label']
				),
			),
			200
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
			__( 'Connected site not found.', 'fair-payments-connector' ),
			array( 'status' => 404 )
		);
	}
}

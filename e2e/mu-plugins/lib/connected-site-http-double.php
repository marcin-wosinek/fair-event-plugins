<?php
/**
 * Fake connected-site transport and External Updates helpers for tests.
 *
 * A Fair Payments Connector Experimental connected site is pulled over
 * wp_safe_remote_get(). Requests to `*.connected-site.e2e.test` are answered
 * here in `pre_http_request`, so the real import code runs offline:
 *
 *   - ok.connected-site.e2e.test       -> two transactions, one page.
 *   - partial.connected-site.e2e.test  -> a full first page of 200
 *                                         transactions, then the second page
 *                                         cannot be reached.
 *   - rejected.connected-site.e2e.test -> 401, as for a revoked token.
 *
 * Transaction IDs start with `tr_e2ecs`. The routes under
 * `fair-e2e/v1/external-updates/` let specs set the Mollie double's payment
 * status, interrupt leftover running runs, and count or remove test
 * transactions.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		$host = (string) wp_parse_url( $url, PHP_URL_HOST );
		if ( ! preg_match( '/^([a-z]+)\.connected-site\.e2e\.test$/', $host, $m ) ) {
			return $preempt;
		}

		$query = array();
		wp_parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$page = isset( $query['page'] ) ? (int) $query['page'] : 1;

		$json = static function ( $code, $body ) {
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode( $body ),
				'response' => array(
					'code'    => $code,
					'message' => '',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};

		$transactions = static function ( $prefix, $count ) {
			$rows = array();
			for ( $i = 1; $i <= $count; $i++ ) {
				$rows[] = array(
					'mollie_payment_id' => sprintf( 'tr_e2ecs%s%03d', $prefix, $i ),
					'amount'            => 10,
					'currency'          => 'EUR',
					'status'            => 'paid',
					'testmode'          => true,
					'description'       => 'E2E connected site payment',
					'created_at'        => '2026-09-01 10:00:00',
				);
			}
			return $rows;
		};

		switch ( $m[1] ) {
			case 'ok':
				return $json(
					200,
					array(
						'transactions' => $transactions( 'ok', 2 ),
						'total'        => 2,
					)
				);

			case 'partial':
				if ( $page > 1 ) {
					return new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out' );
				}
				return $json(
					200,
					array(
						'transactions' => $transactions( 'partial', 200 ),
						'total'        => 400,
					)
				);

			case 'rejected':
				return $json( 401, array( 'code' => 'rest_forbidden' ) );
		}

		return new WP_Error( 'http_request_failed', 'Could not resolve host' );
	},
	10,
	3
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Status the Mollie double reports for payments other than
		// tr_e2emanualimport (which is always paid).
		register_rest_route(
			'fair-e2e/v1',
			'/external-updates/mollie-status',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$status = sanitize_key( (string) $request->get_param( 'status' ) );
					update_option( 'fair_e2e_mollie_get_status', $status ? $status : 'paid' );
					return rest_ensure_response( array( 'status' => $status ) );
				},
			)
		);

		// Age running runs past the stale cutoff (optionally just one), so a
		// spec can observe interruption and never waits on another spec's run.
		register_rest_route(
			'fair-e2e/v1',
			'/external-updates/age-running',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;
					$table = \FairPaymentsConnector\Database\Schema::get_external_update_runs_table_name();
					$past  = gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS );
					$id    = absint( $request->get_param( 'id' ) );

					$aged = $id
						? $wpdb->query( $wpdb->prepare( 'UPDATE %i SET updated_at = %s WHERE id = %d AND status = %s', $table, $past, $id, 'running' ) )
						: $wpdb->query( $wpdb->prepare( 'UPDATE %i SET updated_at = %s WHERE status = %s', $table, $past, 'running' ) );

					return rest_ensure_response( array( 'aged' => (int) $aged ) );
				},
			)
		);

		// Count (and remove) test transactions whose Mollie ID starts with a
		// `tr_e2e` prefix, to prove a repeated import never duplicates rows.
		$prefix = static function ( WP_REST_Request $request ) {
			$value = preg_replace( '/[^A-Za-z0-9_]/', '', (string) $request->get_param( 'prefix' ) );
			return 0 === strpos( $value, 'tr_e2e' ) ? $value : 'tr_e2ecs';
		};

		register_rest_route(
			'fair-e2e/v1',
			'/external-updates/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $prefix ) {
						global $wpdb;
						$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
						$like  = $wpdb->esc_like( $prefix( $request ) ) . '%';

						return rest_ensure_response(
							array(
								'rows'     => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE mollie_payment_id LIKE %s', $table, $like ) ),
								'distinct' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(DISTINCT mollie_payment_id) FROM %i WHERE mollie_payment_id LIKE %s', $table, $like ) ),
							)
						);
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) use ( $prefix ) {
						global $wpdb;
						$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
						$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE mollie_payment_id LIKE %s', $table, $wpdb->esc_like( $prefix( $request ) ) . '%' ) );
						return rest_ensure_response( array( 'deleted' => true ) );
					},
				),
			)
		);
	}
);

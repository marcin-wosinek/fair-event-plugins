<?php
/**
 * Plugin Name: Fair Events E2E Transaction Filters
 * Description: Test-only routes for the transactions list search and filter
 *              specs, loaded ONLY inside the Playwright wp-env instance.
 *              Seeds transactions with exact UTC timestamps, linked
 *              participants and WordPress users under a per-run key, sets the
 *              site timezone for the run, and removes it all again.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairPaymentsConnector\Database\Schema' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		$timezone_backup = 'fair_e2e_transaction_filters_timezone';

		/*
		 * Seed one fixture set. Body:
		 * - key: per-run marker, part of every seeded identifier.
		 * - timezone: site timezone for the run (restored on cleanup).
		 * - participants: [ { name, surname } ] — emails are generated.
		 * - users: [ { display_name, role?, password? } ] — logins and emails are generated.
		 * - transactions: [ { amount, status, testmode, description,
		 *   created_at (UTC), participant?, user? (indexes into the lists
		 *   above), participant_id? (raw id, for a missing participant) } ].
		 */
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-filters/seed',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $timezone_backup ) {
					global $wpdb;

					$key = sanitize_key( $request->get_param( 'key' ) );
					if ( '' === $key ) {
						return new WP_Error( 'missing_key', 'A fixture key is required.', array( 'status' => 400 ) );
					}

					$timezone = (string) $request->get_param( 'timezone' );
					if ( '' !== $timezone ) {
						if ( false === get_option( $timezone_backup ) ) {
							add_option( $timezone_backup, (string) get_option( 'timezone_string' ) );
						}
						update_option( 'timezone_string', $timezone );
					}

					$participant_ids = array();
					foreach ( (array) $request->get_param( 'participants' ) as $index => $participant ) {
						$wpdb->insert(
							$wpdb->prefix . 'fair_audience_participants',
							array(
								'name'    => (string) $participant['name'],
								'surname' => (string) $participant['surname'],
								'email'   => "tf{$key}-p{$index}@example.com",
							),
							array( '%s', '%s', '%s' )
						);
						$participant_ids[] = (int) $wpdb->insert_id;
					}

					$user_ids = array();
					foreach ( (array) $request->get_param( 'users' ) as $index => $user ) {
						$user_ids[] = (int) wp_insert_user(
							array(
								'user_login'   => "tf{$key}-u{$index}",
								'user_pass'    => isset( $user['password'] ) ? (string) $user['password'] : wp_generate_password(),
								'user_email'   => "tf{$key}-u{$index}@example.com",
								'display_name' => (string) $user['display_name'],
								'role'         => isset( $user['role'] ) ? sanitize_key( $user['role'] ) : 'subscriber',
							)
						);
					}

					$transaction_ids = array();
					foreach ( (array) $request->get_param( 'transactions' ) as $index => $transaction ) {
						$participant_id = null;
						if ( isset( $transaction['participant_id'] ) ) {
							$participant_id = (int) $transaction['participant_id'];
						} elseif ( isset( $transaction['participant'] ) ) {
							$participant_id = $participant_ids[ (int) $transaction['participant'] ];
						}

						$wpdb->insert(
							\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
							array(
								'mollie_payment_id' => "tr_tf{$key}n{$index}",
								'user_id'           => isset( $transaction['user'] ) ? $user_ids[ (int) $transaction['user'] ] : null,
								'participant_id'    => $participant_id,
								'amount'            => (float) $transaction['amount'],
								'currency'          => 'EUR',
								'status'            => sanitize_key( $transaction['status'] ),
								'testmode'          => empty( $transaction['testmode'] ) ? 0 : 1,
								'description'       => (string) $transaction['description'],
								'metadata'          => '',
								'created_at'        => (string) $transaction['created_at'],
							),
							array( '%s', '%d', '%d', '%f', '%s', '%s', '%d', '%s', '%s', '%s' )
						);
						$transaction_ids[] = (int) $wpdb->insert_id;
					}

					return rest_ensure_response(
						array(
							'transaction_ids' => $transaction_ids,
							'participant_ids' => $participant_ids,
							'user_ids'        => $user_ids,
						)
					);
				},
			)
		);

		// Remove everything seeded under a key and restore the timezone.
		register_rest_route(
			'fair-e2e/v1',
			'/transaction-filters/seed',
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) use ( $timezone_backup ) {
					global $wpdb;

					$key = sanitize_key( $request->get_param( 'key' ) );
					if ( '' === $key ) {
						return new WP_Error( 'missing_key', 'A fixture key is required.', array( 'status' => 400 ) );
					}

					$wpdb->query(
						$wpdb->prepare(
							'DELETE FROM %i WHERE mollie_payment_id LIKE %s',
							\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
							$wpdb->esc_like( "tr_tf{$key}n" ) . '%'
						)
					);
					$wpdb->query(
						$wpdb->prepare(
							'DELETE FROM %i WHERE email LIKE %s',
							$wpdb->prefix . 'fair_audience_participants',
							$wpdb->esc_like( "tf{$key}-p" ) . '%'
						)
					);

					require_once ABSPATH . 'wp-admin/includes/user.php';
					$user_ids = $wpdb->get_col(
						$wpdb->prepare(
							'SELECT ID FROM %i WHERE user_login LIKE %s',
							$wpdb->users,
							$wpdb->esc_like( "tf{$key}-u" ) . '%'
						)
					);
					foreach ( $user_ids as $user_id ) {
						wp_delete_user( (int) $user_id );
					}

					$previous = get_option( $timezone_backup );
					if ( false !== $previous ) {
						update_option( 'timezone_string', $previous );
						delete_option( $timezone_backup );
					}

					return rest_ensure_response( array( 'deleted' => true ) );
				},
			)
		);
	}
);

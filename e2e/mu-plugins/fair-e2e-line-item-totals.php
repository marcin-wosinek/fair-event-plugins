<?php
/**
 * Plugin Name: Fair Events E2E Line Item Totals
 * Description: Test-only fixtures for the line-item total specs, loaded ONLY
 *              inside the Playwright wp-env instance. Overrides resolved
 *              ticket and activity prices with values the two-decimal price
 *              columns cannot store (fractions of a cent, discounts), changes
 *              a transaction's line items or total the way a third-party
 *              filter would, and reads back what a purchase stored: signup
 *              amounts, transaction amounts and ledger line items.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- test-only fixture routes.

/**
 * The fixture a spec armed, with every key present.
 *
 * @return array
 */
function fair_e2e_line_item_totals_fixture() {
	return wp_parse_args(
		(array) get_option( 'fair_e2e_line_item_totals', array() ),
		array(
			// Resolved price by ticket type ID.
			'ticket_types' => array(),
			// Resolved price by activity (ticket option) ID.
			'options'      => array(),
			// Amount of a line a filter appends to every transaction.
			'extra_line'   => null,
			// Amount a filter adds to the total without touching the lines.
			'total_delta'  => null,
		)
	);
}

// Late, so the override is the price every caller resolves.
add_filter(
	'fair_events_resolve_ticket_price',
	static function ( $price, $ticket_type_id ) {
		$prices = fair_e2e_line_item_totals_fixture()['ticket_types'];

		return isset( $prices[ (int) $ticket_type_id ] ) ? (float) $prices[ (int) $ticket_type_id ] : $price;
	},
	999,
	2
);

add_filter(
	'fair_events_signup_option_prices',
	static function ( $prices ) {
		foreach ( fair_e2e_line_item_totals_fixture()['options'] as $option_id => $price ) {
			if ( array_key_exists( (int) $option_id, (array) $prices ) ) {
				$prices[ (int) $option_id ] = (float) $price;
			}
		}

		return $prices;
	},
	999
);

add_filter(
	'fair_payment_before_validate_line_items',
	static function ( $line_items ) {
		$extra = fair_e2e_line_item_totals_fixture()['extra_line'];
		if ( null !== $extra ) {
			$line_items[] = array(
				'name'     => 'E2E filtered line',
				'quantity' => 1,
				'amount'   => (float) $extra,
			);
		}

		return $line_items;
	},
	999
);

add_filter(
	'fair_payment_calculated_total',
	static function ( $total ) {
		$delta = fair_e2e_line_item_totals_fixture()['total_delta'];

		return null === $delta ? $total : $total + (float) $delta;
	},
	999
);

add_action(
	'rest_api_init',
	static function () {
		if ( ! class_exists( '\FairPaymentsConnector\Models\Transaction' ) ) {
			return;
		}

		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Arm the fixture: { ticket_types, options, extra_line, total_delta }.
		// An empty body disarms it.
		register_rest_route(
			'fair-e2e/v1',
			'/line-item-totals/fixture',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$fixture = array();
					foreach ( array( 'ticket_types', 'options' ) as $key ) {
						$fixture[ $key ] = array();
						foreach ( (array) $request->get_param( $key ) as $id => $price ) {
							$fixture[ $key ][ absint( $id ) ] = (float) $price;
						}
					}
					foreach ( array( 'extra_line', 'total_delta' ) as $key ) {
						$value           = $request->get_param( $key );
						$fixture[ $key ] = null === $value ? null : (float) $value;
					}

					update_option( 'fair_e2e_line_item_totals', $fixture, false );

					return rest_ensure_response( fair_e2e_line_item_totals_fixture() );
				},
			)
		);

		// What purchases stored: the signup rows of the given event dates,
		// and the transactions (those signups' and any named by ID) with
		// their ledger line items. Amounts are the stored decimal strings.
		register_rest_route(
			'fair-e2e/v1',
			'/line-item-totals',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$event_date_ids  = array_values( array_filter( array_map( 'absint', (array) $request->get_param( 'event_date_ids' ) ) ) );
					$transaction_ids = array_values( array_filter( array_map( 'absint', (array) $request->get_param( 'transaction_ids' ) ) ) );

					$signups = array();
					if ( $event_date_ids ) {
						$signups = $wpdb->get_results(
							$wpdb->prepare(
								'SELECT id, event_date_id, email, quantity, amount, status, transaction_id FROM %i WHERE event_date_id IN (' . implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) ) . ') ORDER BY id ASC',
								array_merge( array( $wpdb->prefix . 'fair_events_signups' ), $event_date_ids )
							)
						);
					}

					foreach ( $signups as $signup ) {
						if ( $signup->transaction_id ) {
							$transaction_ids[] = (int) $signup->transaction_id;
						}
					}

					$transactions = array();
					foreach ( array_values( array_unique( $transaction_ids ) ) as $transaction_id ) {
						$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
						if ( ! $transaction ) {
							continue;
						}

						$transactions[] = array(
							'id'         => (int) $transaction->id,
							'amount'     => (string) $transaction->amount,
							'status'     => (string) $transaction->status,
							'line_items' => array_map(
								static function ( $line ) {
									return array(
										'name'         => (string) $line->name,
										'quantity'     => (int) $line->quantity,
										'unit_amount'  => (string) $line->unit_amount,
										'total_amount' => (string) $line->total_amount,
									);
								},
								\FairPaymentsConnector\Models\LineItem::get_by_transaction_id( $transaction_id )
							),
						);
					}

					return rest_ensure_response(
						array(
							'signups'      => array_map(
								static function ( $signup ) {
									return array(
										'id'             => (int) $signup->id,
										'event_date_id'  => (int) $signup->event_date_id,
										'email'          => (string) $signup->email,
										'quantity'       => (int) $signup->quantity,
										'amount'         => (string) $signup->amount,
										'status'         => (string) $signup->status,
										'transaction_id' => $signup->transaction_id ? (int) $signup->transaction_id : null,
									);
								},
								$signups
							),
							'transactions' => $transactions,
						)
					);
				},
			)
		);
	}
);

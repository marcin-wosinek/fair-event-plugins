<?php
/**
 * Connector transactions and payment links for the Statistics and purchase
 * payment history API coverage (#2141, #2251).
 *
 * Usage: wp eval-file .../payment-readers.php <action> <json>
 *
 * Actions:
 *   transaction  {amount, currency?, status, createdAt (`Y-m-d H:i:s`),
 *                metadata?}  Insert one Connector transaction.
 *   link         {signupId, transactionId, role?, amount, currency?,
 *                createdAt}  Insert one payment link.
 *   latest       {signupId, transactionId}  Point the purchase's latest
 *                    attempt (fair_events_signups.transaction_id) at it.
 *   attempt-purchases {transactionId}  The purchase IDs the buyer's payment
 *                    callback resolves for the attempt.
 *   notification {transactionId}  The Connector notification context
 *                    after every enrichment filter.
 *   cleanup      {transactionIds}  Remove the transactions and every link
 *                    naming them.
 *   currency     {currency}  Set the site currency, or remove the option
 *                    for null. Prints the previous value (null if unset),
 *                    for a spec to restore in afterAll.
 *
 * Rows are written directly, so no lifecycle hook runs. Prints one
 * `E2E_PAYMENT_READERS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\SignupPaymentLink;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$currency_option  = 'fair_payment_currency';
$fixture_currency = 'EUR';
$transactions     = $wpdb->prefix . 'fair_payment_transactions';
$result           = array();

switch ( $fixture_action ) {
	case 'transaction':
		$wpdb->insert(
			$transactions,
			array(
				'mollie_payment_id' => 'tr_readers_' . wp_generate_uuid4(),
				'amount'            => (float) $data['amount'],
				'currency'          => (string) ( $data['currency'] ?? $fixture_currency ),
				'status'            => (string) $data['status'],
				'description'       => 'Payment readers fixture',
				'metadata'          => isset( $data['metadata'] ) ? wp_json_encode( $data['metadata'] ) : null,
				'created_at'        => (string) $data['createdAt'],
			)
		);
		$result = array( 'transactionId' => (int) $wpdb->insert_id );
		break;

	case 'link':
		$wpdb->insert(
			SignupPaymentLink::table(),
			array(
				'signup_id'        => (int) $data['signupId'],
				'transaction_id'   => (int) $data['transactionId'],
				'role'             => (string) ( $data['role'] ?? SignupPaymentLink::ROLE_CHARGE ),
				'allocated_amount' => (float) $data['amount'],
				'currency'         => (string) ( $data['currency'] ?? $fixture_currency ),
				'attribution'      => SignupPaymentLink::ATTRIBUTION_LIVE,
				'evidence'         => wp_json_encode( array( 'type' => 'e2e' ) ),
				'created_at'       => (string) $data['createdAt'],
				'recorded_at'      => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		$result = array( 'linkId' => (int) $wpdb->insert_id );
		break;

	case 'latest':
		$wpdb->update(
			$wpdb->prefix . 'fair_events_signups',
			array( 'transaction_id' => (int) $data['transactionId'] ),
			array( 'id' => (int) $data['signupId'] )
		);
		$result = array( 'signupId' => (int) $data['signupId'] );
		break;

	case 'attempt-purchases':
		$result = array(
			'signupIds' => array_map(
				static fn( $row ) => (int) $row->id,
				\FairEvents\Services\PurchasePaymentHistory::signups_for_transaction( (int) $data['transactionId'] )
			),
		);
		break;

	case 'notification':
		$transaction = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $transactions, (int) $data['transactionId'] ) );
		$result      = array(
			'context' => apply_filters( 'fair_payment_notification_context', array(), $transaction, null ),
		);
		break;

	case 'cleanup':
		$ids = array_values( array_filter( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) ) );
		foreach ( $ids as $transaction_id ) {
			$wpdb->delete( SignupPaymentLink::table(), array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $transactions, array( 'id' => $transaction_id ) );
		}
		$result = array( 'removed' => count( $ids ) );
		break;

	case 'currency':
		$result = array( 'previous' => get_option( $currency_option, null ) );
		if ( null === ( $data['currency'] ?? null ) ) {
			delete_option( $currency_option );
		} else {
			update_option( $currency_option, (string) $data['currency'] );
		}
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_PAYMENT_READERS:' . wp_json_encode( (object) $result ) . "\n";

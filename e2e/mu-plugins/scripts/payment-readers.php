<?php
/**
 * Prepare and inspect the stage 5 reader activation for the Statistics API
 * coverage (#2141, stage 5 of #2111).
 *
 * Usage: wp eval-file .../payment-readers.php <action> <json>
 *
 * Actions:
 *   prepare      {}  Stash the reader activation and site currency, then
 *                    remove the activation, so the site starts on the Fair
 *                    Audience readers, and pin the currency to EUR, the
 *                    rows' default. Prints the activation facts and blockers.
 *   activate     {}  Record the activation directly, as an administrator's
 *                    switch would after verification.
 *   facts        {}  The activation facts, blockers and stored activation.
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
 *   restore      {}  Put the stashed activation and currency back.
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
use FairEvents\Services\PaymentHistoryReaders;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$saved_option     = 'fair_e2e_payment_readers_saved';
$currency_option  = 'fair_payment_currency';
$fixture_currency = 'EUR';
$transactions     = $wpdb->prefix . 'fair_payment_transactions';
$result           = array();

switch ( $fixture_action ) {
	case 'prepare':
		// Stash once, so a rerun after a crashed run keeps the original.
		$saved = get_option( $saved_option, false );
		if ( ! is_array( $saved ) ) {
			$saved = array( 'readers' => get_option( PaymentHistoryReaders::OPTION, null ) );
		}
		if ( ! array_key_exists( 'currency', $saved ) ) {
			$saved['currency'] = get_option( $currency_option, null );
		}
		update_option( $saved_option, $saved, false );
		delete_option( PaymentHistoryReaders::OPTION );
		// Revenue sums only the site currency: pin it to the fixture's, as
		// other specs (e.g. the audit log's) leave it switched.
		update_option( $currency_option, $fixture_currency );
		$facts  = PaymentHistoryReaders::facts();
		$result = array(
			'facts'    => $facts,
			'blockers' => PaymentHistoryReaders::blockers( $facts ),
		);
		break;

	case 'activate':
		update_option(
			PaymentHistoryReaders::OPTION,
			array(
				'activated_at' => gmdate( 'Y-m-d H:i:s' ),
				'reason'       => PaymentHistoryReaders::REASON_VERIFIED,
				'user_id'      => 0,
				'reference'    => 'e2e',
			),
			true
		);
		$result = array( 'active' => PaymentHistoryReaders::active() );
		break;

	case 'facts':
		$facts  = PaymentHistoryReaders::facts();
		$result = array(
			'facts'      => $facts,
			'blockers'   => PaymentHistoryReaders::blockers( $facts ),
			'activation' => PaymentHistoryReaders::get_activation(),
			'active'     => PaymentHistoryReaders::active(),
		);
		break;

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

	case 'restore':
		$saved = get_option( $saved_option, false );
		if ( is_array( $saved ) ) {
			if ( null === $saved['readers'] ) {
				delete_option( PaymentHistoryReaders::OPTION );
			} else {
				update_option( PaymentHistoryReaders::OPTION, $saved['readers'], true );
			}
			if ( array_key_exists( 'currency', $saved ) ) {
				if ( null === $saved['currency'] ) {
					delete_option( $currency_option );
				} else {
					update_option( $currency_option, $saved['currency'] );
				}
			}
			delete_option( $saved_option );
		}
		$result = array( 'active' => PaymentHistoryReaders::active() );
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

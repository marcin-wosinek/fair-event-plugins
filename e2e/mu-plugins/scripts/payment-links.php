<?php
/**
 * Exercise fair-events payment link storage against the real database for
 * PaymentHistoryFoundation API coverage (#2138).
 *
 * Usage: wp eval-file .../payment-links.php <action> <json>
 *
 * Actions:
 *   schema              {}  The links table's indexes, the provenance column
 *                           and its unique index, and the DB version.
 *   upgrade             {}  Put the schema back to 3.48.0 (no links table,
 *                           no provenance column), then run maybe_upgrade()
 *                           twice, reporting the schema after each run.
 *   reinstall           {}  Run Installer::install() twice on the current
 *                           schema, reporting the schema after each run.
 *   seed                {eventDateId, signups, amount, currency?, status?}
 *                           That many confirmed signups and one Connector
 *                           transaction of that amount.
 *   write               {transactionId, links}  PaymentLinks::write(),
 *                           with the time it started and finished.
 *   links               {transactionId, signupId?}  Stored links, and the
 *                           purchase's history from PaymentLinks::get_for_signup().
 *   raw-duplicate       {signupId, transactionId, role}  Insert a link
 *                           directly, bypassing the service.
 *   provenance-duplicate {eventDateId, relationshipId}  Insert two signups
 *                           naming the same provenance.
 *   hold-lock           {transactionId, seconds}  Hold the writer lock.
 *   delete-transaction  {transactionId}  Delete it in Connector, as an
 *                           administrator can.
 *   cleanup             {transactionIds, signupIds}
 *   parallel            {runs: [{action, data, delayMs?}]}  Run each action
 *                           as its own `wp eval-file` process inside the
 *                           container, all at once (each started delayMs
 *                           after the previous one), and report their
 *                           results in order. Concurrent writers must go
 *                           through this one call: parallel `wp-env run`
 *                           invocations from the spec broke the wp-env
 *                           environment for the rest of the CI job.
 *
 * Prints one `E2E_PAYMENT_LINKS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange -- Test fixture inspects and resets exact schema.
 * phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.system_calls_proc_open, WordPress.WP.AlternativeFunctions -- The parallel action runs WP-CLI children in the test container.
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$links_table        = $wpdb->prefix . 'fair_events_signup_payment_links';
$signups_table      = $wpdb->prefix . 'fair_events_signups';
$transactions_table = $wpdb->prefix . 'fair_payment_transactions';
$result             = array();

$schema = static function () use ( $wpdb, $links_table, $signups_table ) {
	$table_exists = $links_table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $links_table ) );
	$indexes      = array();
	if ( $table_exists ) {
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SHOW INDEX FROM %i', $links_table ), ARRAY_A ) as $row ) {
			$indexes[ $row['Key_name'] ]['unique']    = '0' === (string) $row['Non_unique'];
			$indexes[ $row['Key_name'] ]['columns'][] = $row['Column_name'];
		}
	}
	$engine     = $table_exists ? $wpdb->get_var( $wpdb->prepare( 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $links_table ) ) : null;
	$provenance = $wpdb->get_row( $wpdb->prepare( 'SHOW INDEX FROM %i WHERE Key_name = %s', $signups_table, 'idx_legacy_event_participant_id' ), ARRAY_A );
	$column     = $wpdb->get_row( $wpdb->prepare( 'SHOW COLUMNS FROM %i LIKE %s', $signups_table, 'legacy_event_participant_id' ), ARRAY_A );

	\FairEvents\Services\PaymentHistoryCompatibility::reset_cache();
	return array(
		'version'          => \FairEvents\Database\Schema::get_db_version(),
		'linksTable'       => $table_exists,
		'engine'           => $engine,
		'indexes'          => $indexes,
		'provenanceColumn' => $column ? array(
			'type' => $column['Type'],
			'null' => $column['Null'],
		) : null,
		'provenanceUnique' => $provenance ? '0' === (string) $provenance['Non_unique'] : null,
		'storageAvailable' => \FairEvents\Services\PaymentHistoryCompatibility::storage_available(),
	);
};

switch ( $fixture_action ) {
	case 'schema':
		$result = $schema();
		break;

	case 'upgrade':
		$non_null = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE legacy_event_participant_id IS NOT NULL', $signups_table ) );
		if ( $non_null ) {
			WP_CLI::error( 'Refusing to reset: signups with provenance exist.' );
		}
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $links_table ) );
		$wpdb->query( $wpdb->prepare( 'ALTER TABLE %i DROP INDEX idx_legacy_event_participant_id, DROP COLUMN legacy_event_participant_id', $signups_table ) );
		\FairEvents\Database\Schema::update_db_version( '3.48.0' );
		$result['before'] = $schema();
		\FairEvents\Database\Installer::maybe_upgrade();
		$result['first'] = $schema();
		\FairEvents\Database\Installer::maybe_upgrade();
		$result['second'] = $schema();
		break;

	case 'reinstall':
		\FairEvents\Database\Installer::install();
		$result['first'] = $schema();
		\FairEvents\Database\Installer::install();
		$result['second'] = $schema();
		break;

	case 'seed':
		$signup_ids = array();
		for ( $i = 0; $i < (int) $data['signups']; $i++ ) {
			$wpdb->insert(
				$signups_table,
				array(
					'event_date_id' => (int) $data['eventDateId'],
					'name'          => 'Payment links buyer',
					'email'         => 'payment-links@example.test',
					'quantity'      => 1,
					'amount'        => 0,
					'status'        => 'confirmed',
				)
			);
			$signup_ids[] = (int) $wpdb->insert_id;
		}
		$wpdb->insert(
			$transactions_table,
			array(
				'mollie_payment_id' => 'e2e-links-' . wp_generate_uuid4(),
				'event_date_id'     => (int) $data['eventDateId'],
				'amount'            => (float) $data['amount'],
				'currency'          => $data['currency'] ?? 'EUR',
				'status'            => $data['status'] ?? 'paid',
				'metadata'          => wp_json_encode(
					array(
						'source'     => 'fair-events-get-tickets',
						'signup_ids' => $signup_ids,
					)
				),
			)
		);
		$result = array(
			'signupIds'     => $signup_ids,
			'transactionId' => (int) $wpdb->insert_id,
		);
		break;

	case 'write':
		$started = microtime( true );
		$outcome = \FairEvents\Services\PaymentLinks::write( (int) $data['transactionId'], (array) $data['links'] );
		$result  = array(
			'started'  => $started,
			'finished' => microtime( true ),
		) + ( is_wp_error( $outcome )
			? array( 'error' => $outcome->get_error_code() )
			: array(
				'inserted'  => $outcome['inserted'],
				'unchanged' => $outcome['unchanged'],
			) );
		break;

	case 'links':
		$result['links'] = \FairEvents\Models\SignupPaymentLink::get_by_transaction_id( (int) $data['transactionId'] );
		if ( ! empty( $data['signupId'] ) ) {
			$result['history'] = \FairEvents\Services\PaymentLinks::get_for_signup( (int) $data['signupId'] );
		}
		break;

	case 'raw-duplicate':
		$wpdb->suppress_errors( true );
		$result['inserted']     = (bool) $wpdb->insert(
			$links_table,
			array(
				'signup_id'        => (int) $data['signupId'],
				'transaction_id'   => (int) $data['transactionId'],
				'role'             => (string) $data['role'],
				'allocated_amount' => '0.00',
				'currency'         => 'EUR',
				'attribution'      => 'backfill',
				'evidence'         => '{"type":"e2e"}',
				'created_at'       => current_time( 'mysql', true ),
			)
		);
		$result['duplicateKey'] = false !== stripos( (string) $wpdb->last_error, 'Duplicate entry' );
		break;

	case 'provenance-duplicate':
		$wpdb->suppress_errors( true );
		$result['signupIds'] = array();
		$result['inserted']  = array();
		for ( $i = 0; $i < 2; $i++ ) {
			$inserted             = (bool) $wpdb->insert(
				$signups_table,
				array(
					'event_date_id'               => (int) $data['eventDateId'],
					'name'                        => '',
					'email'                       => '',
					'status'                      => 'confirmed',
					'legacy_event_participant_id' => (int) $data['relationshipId'],
				)
			);
			$result['inserted'][] = $inserted;
			if ( $inserted ) {
				$result['signupIds'][] = (int) $wpdb->insert_id;
			}
		}
		$result['duplicateKey'] = false !== stripos( (string) $wpdb->last_error, 'Duplicate entry' );
		break;

	case 'hold-lock':
		$result['acquired'] = \FairEvents\Services\PaymentLinks::acquire_lock( (int) $data['transactionId'] );
		$result['locked']   = microtime( true );
		sleep( (int) $data['seconds'] );
		$result['released'] = microtime( true );
		\FairEvents\Services\PaymentLinks::release_lock( (int) $data['transactionId'] );
		break;

	case 'delete-transaction':
		$result['deleted'] = $wpdb->delete( $transactions_table, array( 'id' => (int) $data['transactionId'] ) );
		break;

	case 'cleanup':
		foreach ( array_filter( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) ) as $transaction_id ) {
			$wpdb->delete( $links_table, array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete( $transactions_table, array( 'id' => $transaction_id ) );
		}
		foreach ( array_filter( array_map( 'intval', (array) ( $data['signupIds'] ?? array() ) ) ) as $signup_id ) {
			$wpdb->delete( $links_table, array( 'signup_id' => $signup_id ) );
			$wpdb->delete( $signups_table, array( 'id' => $signup_id ) );
		}
		break;

	case 'parallel':
		$children = array();
		foreach ( (array) $data['runs'] as $run ) {
			usleep( 1000 * (int) ( $run['delayMs'] ?? 0 ) );
			$stderr     = wp_tempnam( 'e2e-payment-links' );
			$command    = implode(
				' ',
				array_map(
					'escapeshellarg',
					array(
						'wp',
						'eval-file',
						__FILE__,
						(string) $run['action'],
						wp_json_encode( (object) ( $run['data'] ?? array() ) ),
						'--path=' . ABSPATH,
					)
				)
			);
			$pipes      = array();
			$process    = proc_open(
				$command,
				array(
					1 => array( 'pipe', 'w' ),
					2 => array( 'file', $stderr, 'w' ),
				),
				$pipes
			);
			$children[] = array( $process, $pipes, $stderr );
		}
		$result['results'] = array();
		foreach ( $children as list( $process, $pipes, $stderr ) ) {
			$stdout = stream_get_contents( $pipes[1] );
			fclose( $pipes[1] );
			$exit_code    = proc_close( $process );
			$child_errors = (string) file_get_contents( $stderr );
			wp_delete_file( $stderr );
			if ( 0 !== $exit_code || ! preg_match( '/E2E_PAYMENT_LINKS:(\{.*\})/', $stdout, $match ) ) {
				WP_CLI::error( "Parallel run failed ({$exit_code}):\n{$stdout}{$child_errors}" );
			}
			$result['results'][] = json_decode( $match[1], true );
		}
		break;

	default:
		WP_CLI::error( "Unknown action '{$fixture_action}'." );
}

echo 'E2E_PAYMENT_LINKS:' . wp_json_encode( (object) $result ) . "\n";

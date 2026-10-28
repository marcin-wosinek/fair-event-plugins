<?php
/**
 * Drive and inspect fair-events-experimental's queued Meta delivery for the
 * queue integration spec (#1971).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/meta-queue-fixture.php <action> <source> [key] [fields]
 *
 * Every row the spec creates carries `<source>` as its `source_url`, which
 * scopes state and cleanup to that run. Actions:
 *
 * - `add <source> <key> [fields]` queues a Purchase row whose Meta event ID
 *   derives from `<key>`, without scheduling, then writes the JSON `fields`
 *   over it. A string field value `+N`/`-N` becomes the UTC time N seconds
 *   from now, and `null` stores NULL.
 * - `backlog <source> <count>` adds that many such rows at once.
 * - `queue <source> <key>` queues a row through the production enqueue path,
 *   which also brings delivery forward.
 * - `deliver` runs one delivery worker as WP-Cron would, first removing
 *   the due wake-ups; `install` re-runs the schema upgrade;
 *   `reconcile` reconciles the delivery schedule; `clear-wakeups` removes
 *   every delivery wake-up; `drain` runs workers until no queued work is due.
 * - `state <source>` reports only.
 * - `cleanup <source>` deletes the run's rows.
 *
 * Every action prints one `E2E_META_QUEUE:{json}` line with the run's
 * `rows` (oldest first), the scheduled `wakeups`, `now`, the scheduling
 * `status`, and `sent` — Meta event IDs of the run's requests the Graph API
 * double captured, in order. The double's log is a single option, so
 * concurrent workers can lose entries from it; each row's
 * `logged_attempts`, from the plugin's own per-attempt log, counts every
 * send.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\DeliveryAttempts;
use FairEventsExperimental\Meta\DeliverySchedule;
use FairEventsExperimental\Meta\Outbox;

global $wpdb;

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture, no cache to honour.

$fair_e2e_action = $args[0] ?? '';
$source          = $args[1] ?? '';
if ( '' === $fair_e2e_action || ( '' === $source && ! in_array( $fair_e2e_action, array( 'deliver', 'install', 'reconcile', 'clear-wakeups', 'drain' ), true ) ) ) {
	WP_CLI::error( 'Usage: meta-queue-fixture.php <action> <source> [key] [fields]' );
}
if ( ! class_exists( Outbox::class ) ) {
	WP_CLI::error( 'The meta-conversions feature is not loaded.' );
}

$fair_e2e_event = static function ( $key ) use ( $source ) {
	return array(
		'transaction_id' => 0,
		'event_name'     => 'Purchase',
		'event_id'       => hash( 'sha256', 'e2e-meta-queue|' . $source . '|' . $key ),
		'event_time'     => time(),
		'source_url'     => $source,
		'value'          => 1.0,
		'currency'       => 'EUR',
		'order_id'       => '',
		'payment_mode'   => 'test',
		'fbp'            => 'fb.1.1712345678901.e2equeue',
		'fbc'            => '',
		'event_context'  => '',
	);
};

switch ( $fair_e2e_action ) {
	case 'add':
		$event = $fair_e2e_event( $args[2] ?? '' );
		( new Outbox() )->enqueue( $event );
		$fields = isset( $args[3] ) ? json_decode( $args[3], true ) : array();
		foreach ( is_array( $fields ) ? $fields : array() as $column => $value ) {
			if ( is_string( $value ) && preg_match( '/^[+-]\d+$/', $value ) ) {
				$value = gmdate( 'Y-m-d H:i:s', time() + (int) $value );
			}
			if ( null === $value ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE %i SET %i = NULL WHERE event_id = %s', Outbox::table_name(), $column, $event['event_id'] ) );
			} else {
				$wpdb->query( $wpdb->prepare( 'UPDATE %i SET %i = %s WHERE event_id = %s', Outbox::table_name(), $column, $value, $event['event_id'] ) );
			}
		}
		break;
	case 'backlog':
		for ( $i = 0; $i < (int) ( $args[2] ?? 0 ); $i++ ) {
			( new Outbox() )->enqueue( $fair_e2e_event( 'backlog-' . $i ) );
		}
		break;
	case 'queue':
		$queue = new ReflectionMethod( Conversions::class, 'queue' );
		$queue->setAccessible( true );
		$queue->invoke( null, $fair_e2e_event( $args[2] ?? '' ) );
		break;
	case 'deliver':
		// Like WP-Cron, take the due wake-ups off the schedule before running.
		foreach ( DeliverySchedule::wakeups() as $wakeup ) {
			if ( $wakeup['timestamp'] <= time() ) {
				wp_unschedule_event( $wakeup['timestamp'], Conversions::DELIVERY_HOOK, $wakeup['args'] );
			}
		}
		( new Conversions() )->deliver_due();
		break;
	case 'drain':
		for ( $run = 0; $run < 10; $run++ ) {
			$due = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE ( state IN ('pending','retry_pending') AND next_attempt_at <= %s ) OR ( state = 'sending' AND claim_expires_at <= %s )", Outbox::table_name(), current_time( 'mysql', true ), current_time( 'mysql', true ) ) );
			if ( ! (int) $due ) {
				break;
			}
			( new Conversions() )->deliver_due();
		}
		break;
	case 'install':
		Outbox::install();
		break;
	case 'reconcile':
		( new DeliverySchedule() )->reconcile();
		break;
	case 'clear-wakeups':
		wp_unschedule_hook( Conversions::DELIVERY_HOOK );
		break;
	case 'cleanup':
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE source_url = %s', Outbox::table_name(), $source ) );
		break;
	case 'state':
		break;
	default:
		WP_CLI::error( "Unknown action {$fair_e2e_action}." );
}

$rows            = $source ? $wpdb->get_results(
	$wpdb->prepare(
		'SELECT id, event_id, state, attempt_count, claim_token, claim_expires_at, next_attempt_at, result_category, meta_error_type, meta_diagnostics, fbp FROM %i WHERE source_url = %s ORDER BY id ASC',
		Outbox::table_name(),
		$source
	),
	ARRAY_A
) : array();
$fair_e2e_logged = ( new DeliveryAttempts() )->counts_for_outbox( array_column( $rows ? $rows : array(), 'id' ) );
foreach ( $rows ? $rows : array() as $index => $row ) {
	$rows[ $index ]['logged_attempts']  = $fair_e2e_logged[ (int) $row['id'] ] ?? 0;
	$rows[ $index ]['attempt_count']    = (int) $row['attempt_count'];
	$rows[ $index ]['meta_diagnostics'] = null === $row['meta_diagnostics'] ? null : json_decode( $row['meta_diagnostics'], true );
}

$sent = array();
foreach ( (array) get_option( 'fair_e2e_meta_requests', array() ) as $request ) {
	if ( ( $request['data'][0]['event_source_url'] ?? '' ) === $source ) {
		$sent[] = $request['data'][0]['event_id'];
	}
}

echo 'E2E_META_QUEUE:' . wp_json_encode(
	array(
		'rows'    => $rows ? $rows : array(),
		'wakeups' => array_column( DeliverySchedule::wakeups(), 'timestamp' ),
		'now'     => time(),
		'status'  => DeliverySchedule::status(),
		'sent'    => $sent,
	)
) . "\n";

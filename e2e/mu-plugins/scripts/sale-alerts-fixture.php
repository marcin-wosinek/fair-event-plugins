<?php
/**
 * Drive and inspect Telegram ticket sale alerts (#2448) for
 * SaleAlerts.api.spec.js.
 *
 * Usage: wp eval-file .../sale-alerts-fixture.php <action> <json>
 *
 * Actions:
 *   stash      {}  Keep the saved alert settings and bot token to restore,
 *                  then save a well-formed test token.
 *   restore    {}  Put back what `stash` kept.
 *   run        {transactionId}  Run the alert worker for a transaction, as
 *                  its scheduled event would.
 *   recover    {}  Run the hourly recovery once.
 *   digests    {organizer}  Queued digests of an organizer (#2449): when,
 *                  in site-local time, and their arguments.
 *   fire       {organizer}  Run an organizer's queued digests now, as
 *                  WP-Cron would: each is removed, then its callback runs.
 *   retype     {signupId, ticketTypeId}  Give the purchase's last ticket
 *                  unit another ticket type, as an organizer can.
 *   telegram   {chatIds}  Requests the Telegram double logged for those
 *                  chats: text and parse mode.
 *   rows       {transactionIds}  Alert records of those transactions.
 *   cleanup    {transactionIds, chatIds}  Remove those records, every
 *                  queued digest and the double's log entries for those
 *                  chats.
 *   legacy     {settings}  Store settings as a site saved them before the
 *                  organizer switch became the only one (with a sitewide
 *                  `enabled`), run the upgrade migration and return what
 *                  is stored afterwards.
 *   stored     {}  The settings option exactly as stored.
 *   token      {token}  Save that bot token, or remove it when null.
 *
 * Prints one `E2E_SALE_ALERTS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\EventTicket;
use FairEvents\Notifications\SaleAlertDispatcher;
use FairEvents\Notifications\SaleAlertLog;
use FairEvents\Notifications\SaleAlertSettings;
use FairEvents\Notifications\ScheduledSends;
use FairEvents\Notifications\TelegramSettings;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$stash_option = 'fair_e2e_sale_alerts_stash';
$log_option   = 'fair_e2e_telegram_requests';
$result       = array();

switch ( $fixture_action ) {
	case 'stash':
		if ( false === get_option( $stash_option, false ) ) {
			update_option(
				$stash_option,
				array(
					'settings' => get_option( SaleAlertSettings::OPTION, null ),
					'token'    => get_option( TelegramSettings::TOKEN_OPTION, null ),
				),
				false
			);
		}
		delete_option( SaleAlertSettings::OPTION );
		update_option( TelegramSettings::TOKEN_OPTION, '123456789:AAEabcdefghijklmnopqrstuvwxyz012345', false );
		$result = array( 'installed' => SaleAlertLog::maybe_install() );
		break;

	case 'restore':
		$stash = get_option( $stash_option, false );
		if ( is_array( $stash ) ) {
			foreach ( array(
				SaleAlertSettings::OPTION      => $stash['settings'],
				TelegramSettings::TOKEN_OPTION => $stash['token'],
			) as $option => $value ) {
				if ( null === $value ) {
					delete_option( $option );
				} else {
					update_option( $option, $value, false );
				}
			}
		}
		delete_option( $stash_option );
		$result = array( 'restored' => is_array( $stash ) );
		break;

	case 'run':
		SaleAlertDispatcher::handle_worker( (int) $data['transactionId'] );
		$row    = ( new SaleAlertLog() )->get( (int) $data['transactionId'] );
		$result = array( 'row' => $row );
		break;

	case 'recover':
		SaleAlertDispatcher::handle_recovery();
		$result = array( 'recovered' => true );
		break;

	case 'digests':
		$digests = array();
		foreach ( ScheduledSends::events( SaleAlertDispatcher::DIGEST_HOOK ) as list( $timestamp, $event_args ) ) {
			if ( ( $event_args[0] ?? '' ) === (string) $data['organizer'] ) {
				$digests[] = array(
					'timestamp' => $timestamp,
					'local'     => wp_date( 'N H:i', $timestamp ),
					'args'      => $event_args,
				);
			}
		}
		$result = array( 'digests' => $digests );
		break;

	case 'fire':
		$fired = 0;
		foreach ( ScheduledSends::events( SaleAlertDispatcher::DIGEST_HOOK ) as list( $timestamp, $event_args ) ) {
			if ( ( $event_args[0] ?? '' ) === (string) $data['organizer'] ) {
				wp_unschedule_event( $timestamp, SaleAlertDispatcher::DIGEST_HOOK, $event_args );
				SaleAlertDispatcher::handle_digest( ...$event_args );
				++$fired;
			}
		}
		$result = array( 'fired' => $fired );
		break;

	case 'retype':
		$units  = EventTicket::get_by_signup_id( (int) $data['signupId'] );
		$last   = end( $units );
		$result = array( 'retyped' => $last ? EventTicket::set_ticket_type( (int) $last->id, (int) $data['ticketTypeId'] ) : false );
		break;

	case 'telegram':
		$chats    = array_map( 'strval', (array) ( $data['chatIds'] ?? array() ) );
		$requests = array();
		foreach ( (array) get_option( $log_option, array() ) as $entry ) {
			if ( in_array( (string) ( $entry['chat_id'] ?? '' ), $chats, true ) ) {
				$requests[] = array(
					'chat_id'    => (string) $entry['chat_id'],
					'text'       => (string) ( $entry['text'] ?? '' ),
					'parse_mode' => (string) ( $entry['parse_mode'] ?? '' ),
				);
			}
		}
		$result = array( 'requests' => $requests );
		break;

	case 'rows':
		$log  = new SaleAlertLog();
		$rows = array();
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$rows[ $transaction_id ] = $log->get( $transaction_id );
		}
		$result = array(
			'rows'      => $rows,
			'scheduled' => array_map(
				static function ( $transaction_id ) {
					return false !== wp_next_scheduled( SaleAlertDispatcher::WORKER_HOOK, array( $transaction_id ) );
				},
				array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) )
			),
		);
		break;

	case 'cleanup':
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$wpdb->delete( SaleAlertLog::table_name(), array( 'transaction_id' => $transaction_id ) );
			wp_clear_scheduled_hook( SaleAlertDispatcher::WORKER_HOOK, array( $transaction_id ) );
		}
		wp_unschedule_hook( SaleAlertDispatcher::DIGEST_HOOK );
		$chats = array_map( 'strval', (array) ( $data['chatIds'] ?? array() ) );
		update_option(
			$log_option,
			array_values(
				array_filter(
					(array) get_option( $log_option, array() ),
					static function ( $entry ) use ( $chats ) {
						return ! in_array( (string) ( $entry['chat_id'] ?? '' ), $chats, true );
					}
				)
			),
			false
		);
		$result = array( 'cleaned' => true );
		break;

	case 'legacy':
		update_option( SaleAlertSettings::OPTION, (array) ( $data['settings'] ?? array() ), false );
		$migrated = SaleAlertSettings::migrate();
		$result   = array(
			'migrated' => $migrated,
			'stored'   => get_option( SaleAlertSettings::OPTION, null ),
		);
		break;

	case 'stored':
		$result = array( 'stored' => get_option( SaleAlertSettings::OPTION, null ) );
		break;

	case 'token':
		if ( null === ( $data['token'] ?? null ) ) {
			delete_option( TelegramSettings::TOKEN_OPTION );
		} else {
			update_option( TelegramSettings::TOKEN_OPTION, (string) $data['token'], false );
		}
		$result = array( 'token' => null !== ( $data['token'] ?? null ) );
		break;

	default:
		WP_CLI::error( 'Unknown action: ' . $fixture_action );
}

WP_CLI::line( 'E2E_SALE_ALERTS:' . wp_json_encode( $result ) );

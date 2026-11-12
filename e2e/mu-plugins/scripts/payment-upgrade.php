<?php
/**
 * Upgrade states for the supported upgrade path coverage (#2255,
 * PAYMENT_HISTORY_MIGRATION.md §8.17). Run on the `upgrade-path` fresh
 * site (FAIR_E2E_SITE=upgrade-path), never on the shared tests site.
 *
 * Usage: wp eval-file .../payment-upgrade.php <action> <json>
 *
 * Actions:
 *   state       {}  The completion evidence, the stored database versions,
 *                   the staging verification and the intermediate release's
 *                   activation records.
 *   unmigrated  {dbVersion}  Make the site look like an existing one that
 *                   ran the intermediate release without finishing the
 *                   migration: no evidence, no activation, no verification,
 *                   the given stored Fair Events database version.
 *   migrated    {findings?: [{reason, sourceId}],
 *                work?: [{kind, sourceId, status}]}
 *                   Record what the intermediate release records once the
 *                   migration finished (a clean verification, the stage 4
 *                   switch and the stage 5 switch), replacing every finding
 *                   and queued shadow work with the given ones. One call,
 *                   because every WP-CLI run is a request the upgrade check
 *                   decides on.
 *   retire      {}  Remove the intermediate release's activations and
 *                   migration state, as the cleanup will, keeping the
 *                   completion evidence.
 *
 * Writes go to the options and tables directly, so no hook runs. Prints
 * one `E2E_PAYMENT_UPGRADE:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryUpgrade;

global $wpdb;

if ( ! defined( 'FAIR_E2E_FRESH_SITES' ) || 'e2efresh_upgrade_' !== $wpdb->prefix ) {
	WP_CLI::error( 'Run payment-upgrade.php on the upgrade-path fresh site only.' );
}

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$raw_option = static function ( $name ) use ( $wpdb ) {
	$value = $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, $name ) );
	return null === $value ? null : maybe_unserialize( $value );
};

$result = array();
switch ( $fixture_action ) {
	case 'state':
		$result = array(
			'evidence'          => $raw_option( PaymentHistoryUpgrade::EVIDENCE_OPTION ),
			'staging'           => $raw_option( PaymentHistoryUpgrade::STAGING_OPTION ),
			'eventsDbVersion'   => $raw_option( 'fair_events_db_version' ),
			'audienceDbVersion' => $raw_option( 'fair_audience_db_version' ),
			'cutover'           => $raw_option( PaymentHistoryCompatibility::CUTOVER_OPTION ),
			'readers'           => $raw_option( PaymentHistoryCompatibility::READERS_OPTION ),
		);
		break;

	case 'unmigrated':
		delete_option( PaymentHistoryUpgrade::EVIDENCE_OPTION );
		delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
		delete_option( PaymentHistoryCompatibility::READERS_OPTION );
		delete_option( PaymentHistoryCompatibility::STATE_OPTION );
		update_option( 'fair_events_db_version', (string) ( $data['dbVersion'] ?? '3.52.0' ) );
		$result = array( 'ok' => true );
		break;

	case 'migrated':
		$checked_at        = gmdate( 'Y-m-d H:i:s', time() - 60 );
		$state             = PaymentHistoryCompatibility::get_state();
		$state['status']   = 'verified';
		$state['backfill'] = array(
			'status'       => 'complete',
			'cutoffs'      => array(
				'transaction_id'  => 0,
				'relationship_id' => 0,
			),
			'verification' => array(
				'status'     => 'verified',
				'checked_at' => $checked_at,
			),
		);
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		update_option(
			PaymentHistoryCompatibility::CUTOVER_OPTION,
			array(
				'activated_at'        => gmdate( 'Y-m-d H:i:s', time() - 3600 ),
				'user_id'             => 1,
				'backup_confirmed_at' => gmdate( 'Y-m-d H:i:s', time() - 3600 ),
				'reference'           => 'backfill-verification:' . $checked_at,
				'audit_id'            => 1,
			),
			true
		);
		update_option(
			PaymentHistoryCompatibility::READERS_OPTION,
			array(
				'activated_at' => gmdate( 'Y-m-d H:i:s', time() - 30 ),
				'reason'       => PaymentHistoryCompatibility::READERS_REASON_VERIFIED,
				'user_id'      => 1,
				'reference'    => 'backfill-verification:' . $checked_at,
				'audit_id'     => 2,
			),
			true
		);
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentHistoryFinding::table() ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentShadowWork::table() ) );
		foreach ( (array) ( $data['findings'] ?? array() ) as $finding ) {
			PaymentHistoryFinding::record(
				PaymentHistoryFinding::MODE_BACKFILL,
				(string) $finding['reason'],
				PaymentHistoryFinding::SOURCE_TRANSACTION,
				(int) $finding['sourceId']
			);
		}
		foreach ( (array) ( $data['work'] ?? array() ) as $work ) {
			if ( PaymentShadowWork::STATUS_PENDING === $work['status'] ) {
				PaymentShadowWork::enqueue_later( (string) $work['kind'], (int) $work['sourceId'], HOUR_IN_SECONDS );
			} else {
				PaymentShadowWork::defer( (string) $work['kind'], (int) $work['sourceId'], (string) $work['status'], 'e2e_fixture' );
			}
		}
		$result = array( 'ok' => true );
		break;

	case 'retire':
		delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
		delete_option( PaymentHistoryCompatibility::READERS_OPTION );
		delete_option( PaymentHistoryCompatibility::STATE_OPTION );
		$result = array( 'ok' => true );
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

WP_CLI::line( 'E2E_PAYMENT_UPGRADE:' . wp_json_encode( $result ) );

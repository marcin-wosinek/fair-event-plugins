<?php
/**
 * Fixture for weekly email feed subscriptions (#2041).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php seed <suffix>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php state <email>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php confirmation-link <email>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php choose <email> <mode> <feedIds>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php deliver <configId>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-feeds-fixture.php cleanup <sourceIds> <configIds> <emails>
 *
 * `seed` creates four event feeds: A and B with an enabled weekly email, C
 * enabled without one, and D disabled with one. `state` reports a
 * participant's weekly preferences, categories and pending confirmation.
 * `confirmation-link` sends the address's deferred confirmation email, as
 * WP-Cron would, and reports the link it carries. `choose` stores
 * a feed mode and comma-separated feed IDs for a participant as they are,
 * so feeds that cannot be chosen or no longer exist can be set up. `deliver` runs
 * a weekly email configuration's send for the current week, exactly as
 * WP-Cron would, and reports who received it. `cleanup` takes
 * comma-separated lists and removes the participants (with their tokens,
 * feeds and signup rate limits), configurations and feeds.
 *
 * Prints a single `E2E_WEEKLY_FEEDS:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\Configurations;

global $wpdb;

$fixture_action = $args[0] ?? '';
$fixture_out    = array();

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture, no cache to honour.
if ( 'seed' === $fixture_action ) {
	$fixture_suffix  = sanitize_title( $args[1] ?? (string) time() );
	$fixture_sources = new EventSourceRepository();
	$fixture_feeds   = array();
	$fixture_configs = array();
	foreach (
		array(
			'a' => array( true, true ),
			'b' => array( true, true ),
			'c' => array( true, false ),
			'd' => array( false, true ),
		) as $fixture_key => list( $fixture_enabled, $fixture_has_email )
	) {
		$fixture_slug                  = "weekly-feed-{$fixture_key}-{$fixture_suffix}";
		$fixture_feeds[ $fixture_key ] = (int) $fixture_sources->create(
			'Feed ' . strtoupper( $fixture_key ) . ' ' . $fixture_suffix,
			$fixture_slug,
			array(
				array(
					'source_type' => 'categories',
					'config'      => array( 'category_ids' => array( 1 ) ),
				),
			),
			$fixture_enabled
		);
		if ( $fixture_has_email ) {
			$fixture_record                  = Configurations::create(
				Configurations::BULK_EMAIL,
				'Feed ' . strtoupper( $fixture_key ),
				array(
					'enabled'     => true,
					'source_slug' => $fixture_slug,
					'skip_empty'  => false,
					'subject'     => 'Weekly ' . strtoupper( $fixture_key ) . ' ' . $fixture_suffix,
				)
			);
			$fixture_configs[ $fixture_key ] = $fixture_record['id'];
		}
	}
	BulkEmailSettings::refresh_summary();
	$fixture_out = array(
		'feeds'          => $fixture_feeds,
		'configurations' => $fixture_configs,
	);
} elseif ( 'state' === $fixture_action ) {
	$fixture_email       = sanitize_email( $args[1] ?? '' );
	$fixture_participant = $wpdb->get_row(
		$wpdb->prepare( 'SELECT * FROM %i WHERE email = %s', $wpdb->prefix . 'fair_audience_participants', $fixture_email ),
		ARRAY_A
	);
	$fixture_out         = array( 'participant' => null );
	if ( $fixture_participant ) {
		$fixture_id    = (int) $fixture_participant['id'];
		$fixture_token = $wpdb->get_row(
			$wpdb->prepare( 'SELECT token, pending_preferences FROM %i WHERE participant_id = %d', $wpdb->prefix . 'fair_audience_email_confirmation_tokens', $fixture_id ),
			ARRAY_A
		);
		$fixture_out   = array(
			'participant' => array(
				'id'                     => $fixture_id,
				'status'                 => $fixture_participant['status'],
				'email_profile'          => $fixture_participant['email_profile'],
				'weekly_summary_opt_out' => (bool) $fixture_participant['weekly_summary_opt_out'],
				'weekly_feed_mode'       => $fixture_participant['weekly_feed_mode'],
				'feed_ids'               => array_map(
					'intval',
					$wpdb->get_col(
						$wpdb->prepare( 'SELECT feed_id FROM %i WHERE participant_id = %d ORDER BY feed_id', $wpdb->prefix . 'fair_audience_participant_feeds', $fixture_id )
					)
				),
				'category_ids'           => array_map(
					'intval',
					$wpdb->get_col(
						$wpdb->prepare( 'SELECT category_id FROM %i WHERE participant_id = %d ORDER BY category_id', $wpdb->prefix . 'fair_audience_participant_categories', $fixture_id )
					)
				),
			),
			'token'       => $fixture_token ? $fixture_token['token'] : null,
			'pending'     => $fixture_token && null !== $fixture_token['pending_preferences'] ? json_decode( $fixture_token['pending_preferences'], true ) : null,
			'mail'        => array_values(
				array_map(
					static function ( $entry ) {
						return $entry['subject'];
					},
					array_filter(
						(array) get_option( 'fair_e2e_captured_mail', array() ),
						static function ( $entry ) use ( $fixture_email ) {
							return in_array( $fixture_email, (array) $entry['to'], true );
						}
					)
				)
			),
		);
	}
} elseif ( 'confirmation-link' === $fixture_action ) {
	$fixture_email = sanitize_email( $args[1] ?? '' );
	$fixture_hook  = \FairAudience\Services\EmailService::DEFERRED_EMAIL_HOOK;
	foreach ( (array) _get_cron_array() as $fixture_time => $fixture_hooks ) {
		foreach ( $fixture_hooks[ $fixture_hook ] ?? array() as $fixture_event ) {
			list( $fixture_method, $fixture_mail_args ) = $fixture_event['args'];
			if ( 'send_confirmation_email' === $fixture_method && $fixture_email === $fixture_mail_args[0]->email ) {
				wp_unschedule_event( $fixture_time, $fixture_hook, $fixture_event['args'] );
				\FairAudience\Services\EmailService::run_deferred( $fixture_method, $fixture_mail_args );
			}
		}
	}
	$fixture_link = null;
	foreach ( (array) get_option( 'fair_e2e_captured_mail', array() ) as $fixture_entry ) {
		if ( in_array( $fixture_email, (array) $fixture_entry['to'], true )
			&& preg_match( '/https?:\/\/[^\s"\'<>]*[?&]confirm_email_key=[A-Za-z0-9]+/', html_entity_decode( (string) $fixture_entry['body'] ), $fixture_match ) ) {
			$fixture_link = $fixture_match[0];
		}
	}
	if ( ! $fixture_link ) {
		WP_CLI::error( 'No confirmation email captured.' );
	}
	$fixture_parts = wp_parse_url( $fixture_link );
	$fixture_out   = array( 'link' => $fixture_parts['path'] . '?' . $fixture_parts['query'] );
} elseif ( 'choose' === $fixture_action ) {
	$fixture_id = (int) $wpdb->get_var(
		$wpdb->prepare( 'SELECT id FROM %i WHERE email = %s', $wpdb->prefix . 'fair_audience_participants', sanitize_email( $args[1] ?? '' ) )
	);
	if ( ! $fixture_id ) {
		WP_CLI::error( 'Participant not found.' );
	}
	$wpdb->update( $wpdb->prefix . 'fair_audience_participants', array( 'weekly_feed_mode' => $args[2] ?? 'all' ), array( 'id' => $fixture_id ), array( '%s' ), array( '%d' ) );
	( new \FairAudience\Database\ParticipantFeedRepository() )->set_feeds( $fixture_id, array_map( 'intval', array_filter( explode( ',', (string) ( $args[3] ?? '' ) ) ) ) );
	$fixture_out = array( 'participant_id' => $fixture_id );
} elseif ( 'deliver' === $fixture_action ) {
	$fixture_config = $args[1] ?? '';
	$fixture_before = count( (array) get_option( 'fair_e2e_captured_mail', array() ) );
	$fixture_now    = BulkEmailDispatcher::now();
	$fixture_run    = ( new BulkEmailDispatcher() )->process( $fixture_config, BulkEmailDispatcher::iso_week( $fixture_now ), BulkEmailSettings::get( $fixture_config ), $fixture_now );
	$fixture_mail   = array_slice( (array) get_option( 'fair_e2e_captured_mail', array() ), $fixture_before );
	$fixture_out    = array(
		'run'        => $fixture_run,
		'recipients' => array_values(
			array_unique(
				array_merge(
					...array_map(
						static function ( $entry ) {
							return (array) $entry['to'];
						},
						$fixture_mail ? $fixture_mail : array( array( 'to' => array() ) )
					)
				)
			)
		),
	);
} elseif ( 'cleanup' === $fixture_action ) {
	$fixture_list = static function ( $value ) {
		return array_values( array_filter( explode( ',', (string) $value ) ) );
	};
	foreach ( $fixture_list( $args[3] ?? '' ) as $fixture_email ) {
		$fixture_id = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE email = %s', $wpdb->prefix . 'fair_audience_participants', $fixture_email )
		);
		if ( $fixture_id ) {
			foreach ( array( 'fair_audience_email_confirmation_tokens', 'fair_audience_participant_feeds', 'fair_audience_participant_categories' ) as $fixture_table ) {
				$wpdb->delete( $wpdb->prefix . $fixture_table, array( 'participant_id' => $fixture_id ), array( '%d' ) );
			}
			$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => $fixture_id ), array( '%d' ) );
		}
		delete_transient( 'fair_audience_signup_' . md5( $fixture_email ) );
	}
	$fixture_index = get_option( Configurations::INDEX_OPTION, array() );
	foreach ( $fixture_list( $args[2] ?? '' ) as $fixture_config ) {
		BulkEmailDispatcher::unschedule( $fixture_config );
		foreach ( array( '', 'runs', 'last_sent_week', 'next_run' ) as $fixture_suffix ) {
			delete_option( Configurations::option( $fixture_config, $fixture_suffix ) );
		}
		$fixture_index = array_values(
			array_filter(
				$fixture_index,
				static function ( $entry ) use ( $fixture_config ) {
					return $entry['id'] !== $fixture_config;
				}
			)
		);
	}
	update_option( Configurations::INDEX_OPTION, $fixture_index, true );
	foreach ( $fixture_list( $args[1] ?? '' ) as $fixture_source ) {
		( new EventSourceRepository() )->delete( (int) $fixture_source );
	}
	BulkEmailSettings::refresh_summary();
	$fixture_out = array( 'cleaned' => true );
} else {
	WP_CLI::error( 'Usage: weekly-feeds-fixture.php seed|state|confirmation-link|choose|deliver|cleanup …' );
}
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_WEEKLY_FEEDS:' . wp_json_encode( $fixture_out ) . "\n";

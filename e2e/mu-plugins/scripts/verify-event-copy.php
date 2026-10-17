<?php
/**
 * Live copy regression: preserve manual recurrence and activity; clean failures.
 *
 * @package FairEvents
 */

use FairEvents\Models\EventDates;
use FairEvents\Services\EventCopyService;
use FairEvents\Services\RecurrenceService;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test-only fixtures and complete database snapshots.
// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- CLI assertion messages, never HTML.
global $wpdb;
wp_set_current_user( 1 );

$assert          = static function ( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
};
$insert          = static function ( $table, $data ) use ( $wpdb, $assert ) {
	$assert( false !== $wpdb->insert( $wpdb->prefix . $table, $data ), 'Fixture insert failed: ' . $table );
	return (int) $wpdb->insert_id;
};
$snapshot        = static function ( $tables ) use ( $wpdb ) {
	$result = array();
	foreach ( $tables as $table ) {
		$result[ $table ] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i', $wpdb->prefix . $table ), ARRAY_A );
		if ( $wpdb->last_error ) {
			throw new RuntimeException( 'Snapshot query failed: ' . $table ); }
		sort( $result[ $table ] );
	}
	return $result;
};
$activity_tables = array( 'fair_audience_participants', 'fair_audience_event_participants', 'fair_events_signups', 'fair_events_tickets', 'fair_payment_transactions', 'fair_audience_questionnaire_submissions', 'fair_audience_questionnaire_answers' );
$features        = get_option( 'fair_events_experimental_features', array() );
$owned           = array();
$source_post_id  = 0;
$master_id       = 0;
$copy            = null;
try {
	update_option( 'fair_events_experimental_features', array( 'event-tools' => true ) );
	$assert( ! FairEventsExperimental\Core\Features::is_enabled( 'event-tools' ), 'Legacy flag reactivated.' );
	if ( ! defined( 'FAIR_EVENTS_EXPERIMENTAL_FEATURE_EVENT_TOOLS' ) ) {
		define( 'FAIR_EVENTS_EXPERIMENTAL_FEATURE_EVENT_TOOLS', true );
	}
	$assert( ! FairEventsExperimental\Core\Features::is_enabled( 'event-tools' ), 'Constant reactivated unknown flag.' );
	$force = static function () {
		return true;
	};
	add_filter( 'fair_events_experimental_feature_enabled', $force );
	$assert( ! FairEventsExperimental\Core\Features::is_enabled( 'event-tools' ), 'Filter reactivated unknown flag.' );
	remove_filter( 'fair_events_experimental_feature_enabled', $force );
	$source_post_id = wp_insert_post(
		array(
			'post_type'   => 'fair_event',
			'post_title'  => 'Manual copy regression',
			'post_status' => 'publish',
		)
	);
	$master_id      = EventDates::save_or_update_master( $source_post_id, '2040-01-01 10:00:00', '2040-01-01 12:00:00', false );
	EventDates::add_linked_post( $master_id, $source_post_id );
	$assert( 3 === RecurrenceService::set_manual_occurrences( $master_id, array( '2040-01-01', '2040-01-10', '2040-01-20' ) ), 'Manual seed failed.' );
	$type_id   = $insert(
		'fair_events_ticket_types',
		array(
			'event_date_id' => $master_id,
			'name'          => 'General',
		)
	);
	$period_id = $insert(
		'fair_events_ticket_sale_periods',
		array(
			'event_date_id' => $master_id,
			'name'          => 'Standard',
		)
	);
	$insert(
		'fair_events_ticket_prices',
		array(
			'ticket_type_id' => $type_id,
			'sale_period_id' => $period_id,
			'price'          => 12,
		)
	);
	$participant                               = $insert(
		'fair_audience_participants',
		array(
			'name'  => 'Copy regression',
			'email' => 'copy-' . wp_generate_uuid4() . '@example.com',
		)
	);
	$owned['fair_audience_participants']       = $participant;
	$owned['fair_audience_event_participants'] = $insert(
		'fair_audience_event_participants',
		array(
			'participant_id' => $participant,
			'event_id'       => $source_post_id,
			'event_date_id'  => $master_id,
			'label'          => 'signed_up',
			'admin_comment'  => 'Existing linked record',
		)
	);
	$transaction                               = $insert(
		'fair_payment_transactions',
		array(
			'mollie_payment_id' => 'copy-regression',
			'event_date_id'     => $master_id,
			'participant_id'    => $participant,
			'amount'            => 12,
			'status'            => 'paid',
		)
	);
	$owned['fair_payment_transactions']        = $transaction;
	$signup                                    = $insert(
		'fair_events_signups',
		array(
			'event_date_id'  => $master_id,
			'participant_id' => $participant,
			'name'           => 'Copy regression',
			'email'          => 'synthetic@example.com',
			'transaction_id' => $transaction,
			'amount'         => 12,
		)
	);
	$owned['fair_events_signups']              = $signup;
	$ticket                                    = $insert(
		'fair_events_tickets',
		array(
			'reference'             => md5( wp_generate_uuid4() ),
			'signup_id'             => $signup,
			'unit_position'         => 1,
			'event_date_id'         => $master_id,
			'holder_participant_id' => $participant,
		)
	);
	$owned['fair_events_tickets']              = $ticket;
	$submission                                = $insert(
		'fair_audience_questionnaire_submissions',
		array(
			'participant_id' => $participant,
			'event_date_id'  => $master_id,
			'post_id'        => $source_post_id,
			'ticket_id'      => $ticket,
		)
	);
	$owned['fair_audience_questionnaire_submissions'] = $submission;
	$owned['fair_audience_questionnaire_answers']     = $insert(
		'fair_audience_questionnaire_answers',
		array(
			'submission_id' => $submission,
			'question_text' => 'Example question',
			'answer_value'  => 'Existing answer',
		)
	);
	$before_activity                                  = $snapshot( $activity_tables );
	$source = EventCopyService::resolve_source( $master_id );
	$assert( ! is_wp_error( $source ), 'Cannot resolve source.' );
	$source_rows = $snapshot( array( 'fair_event_dates', 'fair_event_date_posts' ) );
	$source_post = get_post( $source_post_id )->to_array();
	$copy        = ( new EventCopyService() )->copy( $source, 'Manual series copy', '2040-02-01 10:00:00', '2040-02-01 12:00:00' );
	$assert( ! is_wp_error( $copy ), 'Manual copy failed.' );
	$assert( 'draft' === get_post_status( $copy['post_id'] ), 'Copied primary post is not draft.' );
	$master = EventDates::get_by_id( $copy['event_date_id'] );
	$assert( 'manual' === $master->recurrence_mode, 'Manual mode lost.' );
	$rows = EventDates::get_generated_by_master_id( $master->id, true );
	$assert(
		array( '2040-02-10', '2040-02-20' ) === array_map(
			static function ( $row ) {
				return substr( $row->start_datetime, 0, 10 );
			},
			$rows
		),
		'Manual dates not shifted.'
	);
	$assert( $before_activity === $snapshot( $activity_tables ), 'Activity copied or modified.' );
	$assert( get_post( $source_post_id )->to_array() === $source_post, 'Source post changed.' );
	foreach ( $source_rows as $table => $rows ) {
		$current = $snapshot( array( $table ) )[ $table ];
		foreach ( $rows as $row ) {
			$assert( in_array( $row, $current, true ), 'Existing event/link changed.' );
		}
	}
	$tables = array_merge( array( 'posts', 'postmeta', 'fair_event_dates', 'fair_event_date_posts', 'fair_events_ticket_types', 'fair_events_ticket_sale_periods', 'fair_events_ticket_prices', 'fair_events_event_date_settings' ), $activity_tables );
	foreach ( array( 'post_insertion', 'event_date_creation', 'recurrence_generation', 'configuration_cloning' ) as $checkpoint ) {
		$before = $snapshot( $tables );
		$fail   = static function ( $value, $stage ) use ( $checkpoint ) {
			return $checkpoint === $stage;
		};
		add_filter( 'fair_events_event_copy_fail_at', $fail, 10, 2 );
		try {
			$failed = ( new EventCopyService() )->copy( $source, 'Failed copy', '2040-03-01 10:00:00', '2040-03-01 12:00:00' );
		} finally {
			remove_filter( 'fair_events_event_copy_fail_at', $fail, 10 );
		}
		$assert( is_wp_error( $failed ), 'Expected failure at ' . $checkpoint );
		$after = $snapshot( $tables );
		foreach ( $tables as $table ) {
			$assert( $before[ $table ] === $after[ $table ], 'Partial copy changed ' . $table . ' at ' . $checkpoint . ' (' . count( $before[ $table ] ) . ' -> ' . count( $after[ $table ] ) . ')' );
		}
	}
	echo 'EVENT_COPY:' . wp_json_encode(
		array(
			'manual'   => true,
			'activity' => true,
			'cleanup'  => true,
			'legacy'   => true,
		)
	);
} finally {
	foreach ( array_reverse( $owned, true ) as $table => $fixture_id ) {
		$wpdb->delete( $wpdb->prefix . $table, array( 'id' => $fixture_id ) );
	}
	if ( is_array( $copy ) ) {
		( new FairEvents\Services\EventTicketConfigurationCopier() )->cleanup( $copy['event_date_id'] );
		EventDates::delete_by_id( $copy['event_date_id'] );
		wp_delete_post( $copy['post_id'], true );
	}
	if ( $master_id ) {
		( new FairEvents\Services\EventTicketConfigurationCopier() )->cleanup( $master_id );
		EventDates::delete_by_id( $master_id ); }
	if ( $source_post_id ) {
		wp_delete_post( $source_post_id, true ); }
	update_option( 'fair_events_experimental_features', $features );
}

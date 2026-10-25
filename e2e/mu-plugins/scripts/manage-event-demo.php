<?php
/**
 * Seed or remove the synthetic Manage Event screenshot demo (#2043).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/manage-event-demo.php seed
 *   wp eval-file wp-content/mu-plugins/scripts/manage-event-demo.php cleanup
 *
 * `seed` first checks that the test-only protections are in place (captured
 * mail, the Mollie HTTP double, the external HTTP guard), then removes any
 * earlier demo and creates one standalone event with everything the ten
 * Manage Event tabs show: ticket prices over two sale periods, add-ons,
 * workshops on a schedule, participants with signups and tickets, a group
 * with rules, scheduled mailings, live payments and finance entries.
 *
 * Every row is synthetic. Dates are fixed offsets from the day of the run
 * (the event starts in 12 days, sales cover the weeks before), because
 * Statistics charts only the four weeks before the event up to today; runs
 * on the same day reproduce the same screens. The demo is found again by the
 * `_fair_e2e_manage_event_demo` post meta and the reserved participant
 * domain, so a rerun or an interrupted run never leaves duplicates behind.
 *
 * Prints one `E2E_MANAGE_EVENT_DEMO:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test fixture writes and removes exact rows.
 */

defined( 'ABSPATH' ) || exit;

require_once WPMU_PLUGIN_DIR . '/lib/event-factory.php';

use FairEvents\Models\EventDates;
use FairEvents\Models\ScheduleItem;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Services\EventBudget;

const FAIR_E2E_DEMO_META     = '_fair_e2e_manage_event_demo';
const FAIR_E2E_DEMO_DOMAIN   = 'manage-event-demo.example.test';
const FAIR_E2E_DEMO_TITLE    = 'Summer Swing Weekend';
const FAIR_E2E_DEMO_GROUP    = 'Demo: Volunteers';
const FAIR_E2E_DEMO_VENUE    = 'Demo: Riverside Dance Hall';
const FAIR_E2E_DEMO_BUDGET   = 'Demo: Summer Swing Weekend';
const FAIR_E2E_DEMO_PAYMENTS = 'tr_demo_manage_event_';

/**
 * Stop unless the test-only support layer captures mail, doubles Mollie and
 * blocks other outgoing HTTP, so seeding can never reach a real person or
 * service.
 *
 * @return array<string,bool> The protections that were checked.
 */
function fair_e2e_demo_verify_protections() {
	$protections = array(
		'mailCaptured'         => has_filter( 'pre_wp_mail' ) !== false,
		'mollieDoubled'        => class_exists( 'Mollie\Api\Http\Adapter\CurlMollieHttpAdapter', false )
			&& ( new ReflectionClass( 'Mollie\Api\Http\Adapter\CurlMollieHttpAdapter' ) )->getFileName() === WPMU_PLUGIN_DIR . '/lib/mollie-http-double.php',
		'externalHttpBlocked'  => function_exists( 'fair_e2e_external_http_blocked' ) && fair_e2e_external_http_blocked(),
		'paymentModeTest'      => 'test' === get_option( 'fair_payment_mode' ),
		'notProductionSiteUrl' => in_array( wp_parse_url( home_url(), PHP_URL_HOST ), array( 'localhost', '127.0.0.1' ), true ),
	);

	$missing = array_keys( array_filter( $protections, static fn( $ok ) => ! $ok ) );
	if ( $missing ) {
		WP_CLI::error( 'Refusing to seed the Manage Event demo; missing protections: ' . implode( ', ', $missing ) );
	}

	return $protections;
}

/**
 * A site-local datetime a number of days from today.
 *
 * @param int    $days Days from today (negative: in the past).
 * @param string $time Time, 'H:i'.
 * @return string 'Y-m-d H:i:s'.
 */
function fair_e2e_demo_at( $days, $time ) {
	$day = new DateTimeImmutable( 'today', wp_timezone() );
	return $day->modify( sprintf( '%+d days', $days ) )->format( 'Y-m-d' ) . ' ' . $time . ':00';
}

/**
 * Delete rows whose column is in a list of ids.
 *
 * @param string $table  Table name without prefix.
 * @param string $column Column to match.
 * @param int[]  $ids    Ids.
 * @return int Deleted rows.
 */
function fair_e2e_demo_delete_in( $table, $column, array $ids ) {
	global $wpdb;

	$ids = array_values( array_filter( array_map( 'intval', $ids ) ) );
	if ( ! $ids ) {
		return 0;
	}
	$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a generated %d list.
	return (int) $wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE %i IN ( $placeholders )", array_merge( array( $wpdb->prefix . $table, $column ), $ids ) ) );
}

/**
 * Select one column of the rows whose column is in a list of ids.
 *
 * @param string $select Column to return.
 * @param string $table  Table name without prefix.
 * @param string $column Column to match.
 * @param int[]  $ids    Ids.
 * @return int[]
 */
function fair_e2e_demo_ids_in( $select, $table, $column, array $ids ) {
	global $wpdb;

	$ids = array_values( array_filter( array_map( 'intval', $ids ) ) );
	if ( ! $ids ) {
		return array();
	}
	$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a generated %d list.
	return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT %i FROM %i WHERE %i IN ( $placeholders )", array_merge( array( $select, $wpdb->prefix . $table, $column ), $ids ) ) ) );
}

/**
 * Remove every demo row, from this run or an earlier, interrupted one.
 *
 * @return array<string,int> Deleted row counts.
 */
function fair_e2e_demo_cleanup() {
	global $wpdb;

	$event_ids = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT post_id FROM %i WHERE meta_key = %s', $wpdb->postmeta, FAIR_E2E_DEMO_META ) )
	);
	$date_ids  = fair_e2e_demo_ids_in( 'id', 'fair_event_dates', 'event_id', $event_ids );

	$participant_ids = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE email LIKE %s', $wpdb->prefix . 'fair_audience_participants', '%@' . $wpdb->esc_like( FAIR_E2E_DEMO_DOMAIN ) ) )
	);
	$transaction_ids = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE mollie_payment_id LIKE %s', $wpdb->prefix . 'fair_payment_transactions', $wpdb->esc_like( FAIR_E2E_DEMO_PAYMENTS ) . '%' ) )
	);
	$group_ids       = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE name = %s', $wpdb->prefix . 'fair_audience_groups', FAIR_E2E_DEMO_GROUP ) )
	);
	$venue_ids       = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE name = %s', $wpdb->prefix . 'fair_event_venues', FAIR_E2E_DEMO_VENUE ) )
	);
	$budget_ids      = array_map(
		'intval',
		$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE name = %s', $wpdb->prefix . 'fair_payment_budgets', FAIR_E2E_DEMO_BUDGET ) )
	);

	$ticket_ids            = fair_e2e_demo_ids_in( 'id', 'fair_events_tickets', 'event_date_id', $date_ids );
	$event_participant_ids = fair_e2e_demo_ids_in( 'id', 'fair_audience_event_participants', 'event_date_id', $date_ids );
	$type_ids              = fair_e2e_demo_ids_in( 'id', 'fair_events_ticket_types', 'event_date_id', $date_ids );
	$option_ids            = fair_e2e_demo_ids_in( 'id', 'fair_events_ticket_options', 'event_date_id', $date_ids );

	$deleted = array(
		'ticketActivities'    => fair_e2e_demo_delete_in( 'fair_events_ticket_activities', 'ticket_id', $ticket_ids ),
		'tickets'             => fair_e2e_demo_delete_in( 'fair_events_tickets', 'event_date_id', $date_ids ),
		'signups'             => fair_e2e_demo_delete_in( 'fair_events_signups', 'event_date_id', $date_ids ),
		'participantOptions'  => fair_e2e_demo_delete_in( 'fair_audience_event_participant_options', 'event_participant_id', $event_participant_ids ),
		'participantPayments' => fair_e2e_demo_delete_in( 'fair_audience_event_participant_transactions', 'event_participant_id', $event_participant_ids ),
		'eventParticipants'   => fair_e2e_demo_delete_in( 'fair_audience_event_participants', 'event_date_id', $date_ids ),
		'groupMembers'        => fair_e2e_demo_delete_in( 'fair_audience_group_participants', 'group_id', $group_ids ),
		'groups'              => fair_e2e_demo_delete_in( 'fair_audience_groups', 'id', $group_ids ),
		'participants'        => fair_e2e_demo_delete_in( 'fair_audience_participants', 'id', $participant_ids ),
		'scheduledMessages'   => fair_e2e_demo_delete_in( 'fair_audience_event_scheduled_messages', 'event_date_id', $date_ids ),
		'groupPricingRules'   => fair_e2e_demo_delete_in( 'fair_events_group_pricing_rules', 'event_date_id', $date_ids ),
		'groupPermissions'    => fair_e2e_demo_delete_in( 'fair_events_group_permission_rules', 'event_date_id', $date_ids ),
		'scheduleItems'       => fair_e2e_demo_delete_in( 'fair_events_schedule_items', 'event_date_id', $date_ids ),
		'optionPrices'        => fair_e2e_demo_delete_in( 'fair_events_ticket_option_prices', 'ticket_option_id', $option_ids ),
		'ticketOptions'       => fair_e2e_demo_delete_in( 'fair_events_ticket_options', 'event_date_id', $date_ids ),
		'ticketPrices'        => fair_e2e_demo_delete_in( 'fair_events_ticket_prices', 'ticket_type_id', $type_ids ),
		'ticketTypes'         => fair_e2e_demo_delete_in( 'fair_events_ticket_types', 'event_date_id', $date_ids ),
		'salePeriods'         => fair_e2e_demo_delete_in( 'fair_events_ticket_sale_periods', 'event_date_id', $date_ids ),
		'dateSettings'        => fair_e2e_demo_delete_in( 'fair_events_event_date_settings', 'event_date_id', $date_ids ),
		'financialEntries'    => fair_e2e_demo_delete_in( 'fair_payment_financial_entries', 'event_date_id', $date_ids )
			+ fair_e2e_demo_delete_in( 'fair_payment_financial_entries', 'budget_id', $budget_ids ),
		'budgets'             => fair_e2e_demo_delete_in( 'fair_payment_budgets', 'id', $budget_ids ),
		'lineItems'           => fair_e2e_demo_delete_in( 'fair_payment_line_items', 'transaction_id', $transaction_ids ),
		'transactions'        => fair_e2e_demo_delete_in( 'fair_payment_transactions', 'id', $transaction_ids ),
		'datePosts'           => fair_e2e_demo_delete_in( 'fair_event_date_posts', 'event_date_id', $date_ids ),
		'eventDates'          => fair_e2e_demo_delete_in( 'fair_event_dates', 'event_id', $event_ids ),
		'venues'              => fair_e2e_demo_delete_in( 'fair_event_venues', 'id', $venue_ids ),
		'events'              => 0,
	);

	foreach ( $event_ids as $event_id ) {
		$deleted['events'] += wp_delete_post( $event_id, true ) ? 1 : 0;
	}

	return $deleted;
}

/**
 * Synthetic organizer audience. Names are invented; addresses use a reserved
 * domain that cannot receive mail.
 *
 * Each row: name, surname, ticket key, add-on keys, workshop keys, paid
 * timestamp (site-local) or null for a failed payment, email profile.
 *
 * @return array<int,array>
 */
function fair_e2e_demo_people() {
	return array(
		array( 'Lucía', 'Navarro', 'full', array( 'tshirt', 'dinner' ), array( 'lindy' ), fair_e2e_demo_at( -24, '10:12' ), 'marketing' ),
		array( 'Tomás', 'Ferreira', 'full', array( 'dinner' ), array( 'lindy' ), fair_e2e_demo_at( -20, '19:40' ), 'marketing' ),
		array( 'Amara', 'Okafor', 'full', array(), array( 'solo' ), fair_e2e_demo_at( -15, '08:05' ), 'minimal' ),
		array( 'Jonas', 'Lindqvist', 'reduced', array( 'tshirt' ), array( 'solo' ), fair_e2e_demo_at( -13, '13:30' ), 'marketing' ),
		array( 'Mei', 'Tanaka', 'full', array( 'tshirt', 'dinner' ), array( 'lindy' ), fair_e2e_demo_at( -11, '21:15' ), 'marketing' ),
		array( 'Pablo', 'Ruiz', 'reduced', array(), array( 'lindy' ), fair_e2e_demo_at( -9, '11:00' ), 'minimal' ),
		array( 'Elena', 'Popescu', 'full', array( 'dinner' ), array( 'solo' ), fair_e2e_demo_at( -7, '17:45' ), 'marketing' ),
		array( 'Samir', 'Haddad', 'full', array(), array( 'lindy' ), fair_e2e_demo_at( -5, '09:20' ), 'minimal' ),
		array( 'Chloé', 'Martin', 'reduced', array( 'tshirt' ), array( 'solo' ), fair_e2e_demo_at( -4, '20:10' ), 'marketing' ),
		array( 'Kofi', 'Mensah', 'full', array( 'dinner' ), array( 'lindy' ), fair_e2e_demo_at( -2, '14:55' ), 'marketing' ),
		array( 'Ingrid', 'Berg', 'full', array(), array(), fair_e2e_demo_at( -1, '18:30' ), 'minimal' ),
		array( 'Diego', 'Morales', 'reduced', array(), array(), null, 'minimal' ),
	);
}

/**
 * Create the demo event and every row its tabs show.
 *
 * @return array<string,mixed> Ids and the facts the screenshot spec checks.
 */
function fair_e2e_demo_seed() {
	global $wpdb;

	$event_id = fair_e2e_create_event(
		FAIR_E2E_DEMO_TITLE,
		'<!-- wp:paragraph --><p>Two days of social dancing, workshops and live music.</p><!-- /wp:paragraph --><!-- wp:fair-events/event-signup /-->',
		array( FAIR_E2E_DEMO_META => 1 )
	);

	$event_date_id = EventDates::save_occurrence( $event_id, fair_e2e_demo_at( 12, '10:00' ), fair_e2e_demo_at( 13, '23:00' ), false, 'single' );
	if ( ! $event_date_id ) {
		WP_CLI::error( 'Failed to create the demo event date.' );
	}
	$event_date_id = (int) $event_date_id;
	// Manage Event edits the date row's own title, so it carries one too. The
	// event post is its public page; the dateless row saving the post left
	// behind is dropped so the event has exactly one date.
	$wpdb->update(
		$wpdb->prefix . 'fair_event_dates',
		array(
			'title'     => FAIR_E2E_DEMO_TITLE,
			'capacity'  => 80,
			'link_type' => 'post',
		),
		array( 'id' => $event_date_id )
	);
	$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE event_id = %d AND id <> %d AND start_date IS NULL', $wpdb->prefix . 'fair_event_dates', $event_id, $event_date_id ) );
	EventDates::add_linked_post( $event_date_id, $event_id );

	fair_e2e_set_venue( $event_date_id, fair_e2e_create_venue( FAIR_E2E_DEMO_VENUE, 'Carrer del Riu 12, 08001 Barcelona' ) );

	// Ticket pricing: an early-bird period that has ended and a regular one.
	$early   = (int) TicketSalePeriod::create( $event_date_id, 'Early bird', fair_e2e_demo_at( -40, '00:00' ), fair_e2e_demo_at( -12, '23:59' ), 0 );
	$regular = (int) TicketSalePeriod::create( $event_date_id, 'Regular', fair_e2e_demo_at( -11, '00:00' ), fair_e2e_demo_at( 11, '23:59' ), 1 );

	$types   = array(
		'full'    => fair_e2e_add_ticket_type( $event_date_id, 'Full pass', 60 ),
		'reduced' => fair_e2e_add_ticket_type( $event_date_id, 'Student pass', 20 ),
	);
	$amounts = array(
		'full'    => array(
			$early   => 65.00,
			$regular => 85.00,
		),
		'reduced' => array(
			$early   => 45.00,
			$regular => 55.00,
		),
	);
	foreach ( $amounts as $key => $by_period ) {
		foreach ( $by_period as $period_id => $price ) {
			fair_e2e_add_price( $types[ $key ], $period_id, $price );
		}
	}

	$addons    = array(
		'tshirt' => array( fair_e2e_add_option( $event_date_id, 'Festival T-shirt', 20.00, 'T-shirt', 0, 40 ), 20.00 ),
		'dinner' => array( fair_e2e_add_option( $event_date_id, 'Saturday dinner', 25.00, 'Dinner', 1, 50 ), 25.00 ),
	);
	$workshops = array(
		'lindy' => array( fair_e2e_add_option( $event_date_id, 'Lindy Hop fundamentals', 0.00, 'Lindy', 2, 24 ), 'Studio A', fair_e2e_demo_at( 12, '11:00' ), fair_e2e_demo_at( 12, '13:00' ) ),
		'solo'  => array( fair_e2e_add_option( $event_date_id, 'Solo jazz styling', 0.00, 'Solo jazz', 3, 24 ), 'Studio B', fair_e2e_demo_at( 12, '11:00' ), fair_e2e_demo_at( 12, '13:00' ) ),
	);

	// Workshops and program items on the Schedule tab.
	fair_e2e_set_event_date_setting( $event_date_id, 'schedule_enabled', '1' );
	$sort = 0;
	foreach ( $workshops as $workshop ) {
		ScheduleItem::create(
			array(
				'event_date_id'    => $event_date_id,
				'ticket_option_id' => $workshop[0],
				'bookable'         => true,
				'start_datetime'   => $workshop[2],
				'end_datetime'     => $workshop[3],
				'location'         => $workshop[1],
				'sort_order'       => $sort++,
			)
		);
	}
	foreach (
		array(
			array( 'Welcome and registration', fair_e2e_demo_at( 12, '10:00' ), fair_e2e_demo_at( 12, '11:00' ), 'Foyer' ),
			array( 'Evening social with live band', fair_e2e_demo_at( 12, '21:00' ), fair_e2e_demo_at( 13, '01:00' ), 'Main hall' ),
		) as $program_item
	) {
		ScheduleItem::create(
			array(
				'event_date_id'  => $event_date_id,
				'bookable'       => false,
				'title'          => $program_item[0],
				'start_datetime' => $program_item[1],
				'end_datetime'   => $program_item[2],
				'location'       => $program_item[3],
				'sort_order'     => $sort++,
			)
		);
	}

	// Group with a discount and signup visibility, shown on Groups.
	$group = new \FairAudienceExperimental\Models\Group( array( 'name' => FAIR_E2E_DEMO_GROUP ) );
	$group->save();
	\FairEventsExperimental\Models\GroupPricingRule::create( $event_date_id, (int) $group->id, 'percentage', 50 );
	\FairEventsExperimental\Models\GroupPermissionRule::create( $event_date_id, (int) $group->id, 'view_signups' );

	// Participants, their signups, tickets, workshop choices and payments.
	$people     = array();
	$net_income = 0.0;
	foreach ( fair_e2e_demo_people() as $index => $person ) {
		list( $name, $surname, $type_key, $addon_keys, $workshop_keys, $paid_at, $profile ) = $person;

		$participant = new \FairAudience\Models\Participant(
			array(
				'name'          => $name,
				'surname'       => $surname,
				'email'         => strtolower( remove_accents( $name . '.' . $surname ) ) . '@' . FAIR_E2E_DEMO_DOMAIN,
				'email_profile' => $profile,
				'status'        => 'confirmed',
			)
		);
		$participant->save();
		$participant_id = (int) $participant->id;
		if ( $index < 3 ) {
			( new \FairAudienceExperimental\Models\GroupParticipant(
				array(
					'group_id'       => (int) $group->id,
					'participant_id' => $participant_id,
				)
			) )->save();
		}

		$created_at = $paid_at ? $paid_at : fair_e2e_demo_at( -1, '12:00' );
		$period_id  = $created_at <= fair_e2e_demo_at( -12, '23:59' ) ? $early : $regular;
		$amount     = $amounts[ $type_key ][ $period_id ];
		$lines      = array( array( 'full' === $type_key ? 'Full pass' : 'Student pass', $amount ) );
		foreach ( $addon_keys as $addon_key ) {
			$amount += $addons[ $addon_key ][1];
			$lines[] = array( 'tshirt' === $addon_key ? 'Festival T-shirt' : 'Saturday dinner', $addons[ $addon_key ][1] );
		}

		$transaction_id = \FairPaymentsConnector\Models\Transaction::create(
			array(
				'mollie_payment_id' => FAIR_E2E_DEMO_PAYMENTS . ( $index + 1 ),
				'post_id'           => $event_id,
				'event_date_id'     => $event_date_id,
				'user_id'           => null,
				'participant_id'    => $participant_id,
				'amount'            => $amount,
				'currency'          => 'EUR',
				'status'            => $paid_at ? 'paid' : 'failed',
				'description'       => FAIR_E2E_DEMO_TITLE . ' – ' . $name . ' ' . $surname,
			)
		);
		$mollie_fee     = round( 0.29 + $amount * 0.018, 2 );
		// Recorded as a live payment, which is what Finance reports; the row is
		// written directly, so no payment is ever initiated.
		$wpdb->update(
			$wpdb->prefix . 'fair_payment_transactions',
			array(
				'testmode'             => 0,
				'mollie_fee'           => $paid_at ? $mollie_fee : null,
				'payment_initiated_at' => $created_at,
				'created_at'           => $created_at,
				'updated_at'           => $created_at,
			),
			array( 'id' => $transaction_id )
		);
		foreach ( $lines as $sort_order => $line ) {
			$wpdb->insert(
				$wpdb->prefix . 'fair_payment_line_items',
				array(
					'transaction_id' => $transaction_id,
					'name'           => $line[0],
					'quantity'       => 1,
					'unit_amount'    => $line[1],
					'total_amount'   => $line[1],
					'sort_order'     => $sort_order,
					'created_at'     => $created_at,
				)
			);
		}

		$status = $paid_at ? 'confirmed' : 'failed';
		$wpdb->insert(
			$wpdb->prefix . 'fair_events_signups',
			array(
				'event_date_id'  => $event_date_id,
				'ticket_type_id' => $types[ $type_key ],
				'name'           => $name . ' ' . $surname,
				'email'          => $participant->email,
				'quantity'       => 1,
				'mailing_opt_in' => 'marketing' === $profile ? 1 : 0,
				'amount'         => $amount,
				'status'         => $status,
				'transaction_id' => $transaction_id,
				'participant_id' => $participant_id,
				'created_at'     => $created_at,
			)
		);
		$signup_id = (int) $wpdb->insert_id;

		$wpdb->insert(
			$wpdb->prefix . 'fair_events_tickets',
			array(
				'reference'                => md5( 'manage-event-demo-' . $index ),
				'signup_id'                => $signup_id,
				'unit_position'            => 1,
				'event_date_id'            => $event_date_id,
				'ticket_type_id'           => $types[ $type_key ],
				'status'                   => $status,
				'purchaser_participant_id' => $participant_id,
				'holder_participant_id'    => $participant_id,
				'created_at'               => $created_at,
				'updated_at'               => $created_at,
			)
		);
		$ticket_id = (int) $wpdb->insert_id;

		if ( ! $paid_at ) {
			continue;
		}

		$event_participant = new \FairAudience\Models\EventParticipant(
			array(
				'event_id'       => $event_id,
				'event_date_id'  => $event_date_id,
				'participant_id' => $participant_id,
				'label'          => 'signed_up',
				'ticket_type_id' => $types[ $type_key ],
			)
		);
		$event_participant->save();
		$relationship_id = (int) $event_participant->id;
		$wpdb->update( $wpdb->prefix . 'fair_audience_event_participants', array( 'created_at' => $created_at ), array( 'id' => $relationship_id ) );

		foreach ( array_merge( $addon_keys, $workshop_keys ) as $choice ) {
			$option = $addons[ $choice ][0] ?? $workshops[ $choice ][0];
			$label  = (string) $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_ticket_options', $option ) );
			$wpdb->insert(
				$wpdb->prefix . 'fair_events_ticket_activities',
				array(
					'ticket_id'          => $ticket_id,
					'ticket_option_id'   => $option,
					'ticket_option_name' => $label,
					'status'             => 'confirmed',
				)
			);
		}

		( new \FairAudience\Database\EventParticipantTransactionRepository() )->record( $relationship_id, $transaction_id, 'charge' );
		$wpdb->update(
			$wpdb->prefix . 'fair_audience_event_participant_transactions',
			array( 'created_at' => $created_at ),
			array(
				'event_participant_id' => $relationship_id,
				'transaction_id'       => $transaction_id,
			)
		);

		$net_income += $amount - $mollie_fee;
		$people[]    = $name . ' ' . $surname;
	}

	// Two scheduled mailings, timed against the event start.
	foreach (
		array(
			array( 'Your Summer Swing Weekend starts in one week', -7 * DAY_IN_SECONDS / MINUTE_IN_SECONDS, '<p>Hi! The weekend is almost here. Doors open at 10:00 on Saturday.</p>' ),
			array( 'Thank you for dancing with us', 2 * DAY_IN_SECONDS / MINUTE_IN_SECONDS, '<p>Thank you for joining. Photos from the weekend will follow soon.</p>' ),
		) as $mailing
	) {
		$message = new \FairAudienceExperimental\Models\ScheduledMessage(
			array(
				'event_date_id'     => $event_date_id,
				'subject'           => $mailing[0],
				'body'              => $mailing[2],
				'anchor_type'       => $mailing[1] < 0 ? 'event_date_start' : 'event_date_end',
				'offset_minutes'    => (int) $mailing[1],
				'recipients_filter' => array(
					'labels'       => array( 'signed_up' ),
					'group_ids'    => array(),
					'is_marketing' => false,
				),
				'scheduled_for'     => $mailing[1] < 0 ? fair_e2e_demo_at( 5, '10:00' ) : fair_e2e_demo_at( 15, '23:00' ),
				'status'            => 'scheduled',
			)
		);
		$message->save();
	}

	// Finance: a budget, and the costs the organizer booked against the event.
	$budget_id = (int) \FairFinance\Models\Budget::create( FAIR_E2E_DEMO_BUDGET, 'Synthetic budget for the Manage Event screenshots.' );
	EventBudget::set_budget_id( $event_date_id, $budget_id );
	foreach (
		array(
			array( 900.00, substr( fair_e2e_demo_at( -30, '00:00' ), 0, 10 ), 'Venue rental deposit' ),
			array( 650.00, substr( fair_e2e_demo_at( -14, '00:00' ), 0, 10 ), 'Live band fee' ),
			array( 180.00, substr( fair_e2e_demo_at( -6, '00:00' ), 0, 10 ), 'Printed programs and badges' ),
		) as $cost
	) {
		\FairFinance\Models\FinancialEntry::create( $cost[0], 'cost', $cost[1], $cost[2], $budget_id, null, null, $event_date_id );
	}

	return array(
		'eventId'          => $event_id,
		'eventDateId'      => $event_date_id,
		'title'            => FAIR_E2E_DEMO_TITLE,
		'participants'     => $people,
		'firstParticipant' => $people[0],
		'groupName'        => FAIR_E2E_DEMO_GROUP,
		'mailingSubject'   => 'Your Summer Swing Weekend starts in one week',
		'workshop'         => 'Lindy Hop fundamentals',
		'ticketType'       => 'Full pass',
		'costEntry'        => 'Venue rental deposit',
		'paidTickets'      => count( $people ),
		'netIncome'        => round( $net_income, 2 ),
	);
}

$fair_e2e_demo_action = isset( $args[0] ) ? (string) $args[0] : '';

switch ( $fair_e2e_demo_action ) {
	case 'seed':
		$fair_e2e_demo_protections = fair_e2e_demo_verify_protections();
		$fair_e2e_demo_removed     = fair_e2e_demo_cleanup();
		$fair_e2e_demo_result      = array_merge(
			fair_e2e_demo_seed(),
			array(
				'protections' => $fair_e2e_demo_protections,
				'removed'     => $fair_e2e_demo_removed,
			)
		);
		break;

	case 'cleanup':
		$fair_e2e_demo_result = array( 'removed' => fair_e2e_demo_cleanup() );
		break;

	default:
		WP_CLI::error( 'Usage: manage-event-demo.php <seed|cleanup>' );
}

echo 'E2E_MANAGE_EVENT_DEMO:' . wp_json_encode( $fair_e2e_demo_result ) . "\n";
